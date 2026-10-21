const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '../../../../..');
const source = path.join(root, 'packages/desktop/src');
const noop = 'const noop=()=>{}; const empty=[];';

// Only peripheral services are replaced. SendBox, Arco, React, SWR, the draft
// hook, composition/history logic, usePasteService and PasteService stay real.
const mocks = {
  '@/common': `export const ipcBridge={fs:{listAvailableSkills:{invoke:async()=>[]},listWorkspaceFiles:{invoke:async()=>[]}}};`,
  'react-i18next': `const t=(key,options)=>options?.defaultValue??key;export const useTranslation=()=>({t,i18n:{language:'en'}});`,
  '@/renderer/hooks/chat/useInputFocusRing': `export const useInputFocusRing=()=>({activeBorderColor:'gray',inactiveBorderColor:'gray',activeShadow:'none'});`,
  '@/renderer/hooks/context/LayoutContext': `export const useLayoutContext=()=>({isMobile:false});`,
  '@/renderer/hooks/context/ConversationContext': `const context={conversation_id:'composer-browser-test',type:'acp'};export const useConversationContextSafe=()=>context;`,
  '@/renderer/pages/conversation/Preview': `${noop} const context={setSendBoxHandler:noop,domSnippets:empty,removeDomSnippet:noop,clearDomSnippets:noop};export const usePreviewContext=()=>context;`,
  '@/renderer/pages/conversation/Messages/hooks': `const messages=[{id:'history-1',msg_id:'history-1',conversation_id:'composer-browser-test',type:'text',position:'right',content:{content:'previous prompt'}}];export const useMessageList=()=>messages;`,
  '@/renderer/hooks/file/useConversationExport': `${noop} export const useConversationExport=()=>({isOpen:false,showMenu:false,step:'menu',filename:'',pathPreview:'',menuItems:empty,activeIndex:0,loading:false,openExportFlow:noop,closeExportFlow:noop,handleKeyDown:()=>false,onSelectMenuItem:noop,setActiveIndex:noop,setFilename:noop,submitFilename:noop});`,
  '@/renderer/components/chat/BtwOverlay/useBtwCommand': `${noop} export const useBtwCommand=()=>({answer:'',question:'',isLoading:false,isOpen:false,ask:noop,dismiss:noop});`,
  '@/renderer/hooks/file/useDragUpload': `export const useDragUpload=()=>({isFileDragging:false,dragHandlers:{}});`,
  '@/renderer/hooks/file/useUploadState': `${noop} export const useUploadState=()=>({isUploading:false}); export const trackUpload=()=>({onProgress:noop,finish:noop});`,
  '@/renderer/hooks/file/useAbortUploadsOnConversationChange': `export const useAbortUploadsOnConversationChange=()=>{};`,
  '@/renderer/utils/emitter': `export const emitter={emit:()=>{}}; export const useAddEventListener=()=>{};`,
  '@/renderer/hooks/chat/useSessionMentionSearch': `${noop} export const useSessionMentionSearch=()=>({items:empty,loading:false});`,
  '@/renderer/pages/conversation/explorer/search/useProjectMentionSearch': `${noop} export const useProjectMentionSearch=()=>({active:false,items:empty,loading:false});`,
  '@/renderer/services/FileService': `export const allSupportedExts=[]; export const getFileExtension=name=>name.slice(name.lastIndexOf('.')); export const UPLOAD_ABORTED_ERROR='UPLOAD_ABORTED';export const uploadFileViaHttp=()=>{throw Error('Uploads are outside this test');};`,
  '@/renderer/utils/common': `let id=0;export const uuid=()=>String(++id);`,
  '@/common/adapter/httpBridge': `export const getBaseUrl=()=>'';`,
  '@/renderer/hooks/system/useSpeechInput': `export const appendSpeechTranscript=(prev,text)=>prev?prev+' '+text:text;`,
};

for (const id of [
  '@/renderer/components/chat/AtFileMenu',
  '@/renderer/components/chat/AtSessionMenu',
  '@/renderer/components/chat/BtwOverlay',
  '@/renderer/components/chat/SlashCommandMenu',
  '@/renderer/components/chat/SpeechInputButton',
  '@/renderer/components/media/UploadProgressBar',
]) {
  mocks[id] = 'export default ()=>null;';
}

async function buildHarness() {
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, 'ComposerHarness.tsx')],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    loader: { '.css': 'empty', '.svg': 'dataurl' },
    plugins: [
      {
        name: 'composer-test-peripherals',
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            let id = args.path.startsWith('@renderer/') ? '@/renderer/' + args.path.slice(10) : args.path;
            if (args.path === './FileService' && args.importer.endsWith('PasteService.ts')) {
              id = '@/renderer/services/FileService';
            }
            if (mocks[id]) return { path: id, namespace: 'composer-test-mocks' };
            if (id.startsWith('@/')) {
              return build.resolve(path.join(source, id.slice(2)), { resolveDir: source, kind: args.kind });
            }
          });
          build.onLoad({ filter: /.*/, namespace: 'composer-test-mocks' }, (args) => ({
            contents: mocks[args.path],
            loader: 'js',
          }));
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}

module.exports = { buildHarness };
