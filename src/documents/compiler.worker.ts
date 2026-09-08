interface CompilerWorkerRequest {
  id: string;
  source: string;
  basePath: string;
}

interface CompilerWorkerResponse {
  id: string;
  ok: boolean;
  pdf?: Uint8Array;
  compilationLog?: string;
  error?: string;
}

self.onmessage = async (event: MessageEvent<CompilerWorkerRequest>) => {
  const request = event.data;
  const respond = (response: CompilerWorkerResponse) => self.postMessage(response);
  try {
    const module = await import('texlyre-busytex');
    const runner = new module.BusyTexRunner({
      busytexBasePath: request.basePath,
      engineMode: 'luahbtex',
      verbose: false,
    });
    await runner.initialize(true);
    const compiler = new module.LuaLatex(runner);
    const result = await compiler.compile({
      input: request.source,
      mainTexPath: 'main.tex',
      verbose: 'info',
      shellEscape: false,
    });
    runner.terminate();
    if (!result.success || !result.pdf) {
      respond({ id: request.id, ok: false, compilationLog: result.log, error: 'LuaLaTeX could not compile the document.' });
      return;
    }
    respond({ id: request.id, ok: true, pdf: result.pdf, compilationLog: result.log });
  } catch (cause) {
    respond({ id: request.id, ok: false, error: cause instanceof Error ? cause.message : 'LuaLaTeX failed.' });
  }
};
