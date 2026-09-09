import {registerHooks} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

// Test the actual shared front-end code without producing a second build tree.
registerHooks({
  resolve(specifier,context,nextResolve) {
    if(specifier.startsWith('.') && context.parentURL) {
      const url=new URL(specifier,context.parentURL);
      if(!/\.[a-z]+$/i.test(url.pathname) && existsSync(fileURLToPath(url)+'.ts'))
        return {url:url.href+'.ts',shortCircuit:true};
    }
    return nextResolve(specifier,context);
  },
  load(url,context,nextLoad) {
    if(url.startsWith('file:') && url.endsWith('.ts') && !url.includes('/node_modules/')) {
      const source=readFileSync(fileURLToPath(url),'utf8');
      return {format:'module',shortCircuit:true,source:ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};
    }
    if(url.endsWith('/shared/demo-catalog.json'))
      return {format:'module',shortCircuit:true,source:'export default '+readFileSync(fileURLToPath(url),'utf8')};
    return nextLoad(url,context);
  }
});
