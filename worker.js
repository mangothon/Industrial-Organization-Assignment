// 별도 작업 공간(Web Worker)에서 Pyodide(브라우저용 Python)를 실행한다.
const BASE = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
let py = null;
let chain = Promise.resolve();

const step = (n, text) => postMessage({ type: 'status', step: n, text });

async function boot() {
  if (py) return;
  step(2, 'Python 실행 환경 준비 중… (처음 한 번만, 10~20초)');
  importScripts(BASE + 'pyodide.js');
  py = await loadPyodide({ indexURL: BASE });
  await py.loadPackage(['numpy', 'micropip']);
  await py.runPythonAsync("import micropip\nawait micropip.install('openpyxl==3.1.5')");
  const response = await fetch('./model.py');
  if (!response.ok) throw Error('model.py를 불러올 수 없습니다.');
  await py.runPythonAsync(await response.text());
}

function setBytes(name, buffer) {
  py.globals.set(name + '_js', new Uint8Array(buffer));
  py.runPython(`${name} = ${name}_js.to_py()\ndel ${name}_js`);
}

async function handle({ id, type, payload }) {
  try {
    let result;
    if (type === 'load') {
      await boot();
      if (payload.classification) {
        setBytes('class_bytes', payload.classification);
        py.runPython('load_classification(class_bytes)\ndel class_bytes');
      }
      step(3, 'Excel 읽기와 계수 검증 중…');
      setBytes('raw_bytes', payload.buffer);
      py.globals.set('level_in', payload.level);
      py.globals.set('n_in', payload.n);
      result = py.runPython('_r = initialize(level_in, raw_bytes, n_in)\ndel raw_bytes\n_r');
    } else if (type === 'explore') {
      py.globals.set('args_in', JSON.stringify(payload));
      result = py.runPython("_a = json.loads(args_in)\nexplore(_a['level'], _a['sheet'], _a['axis'], _a['key'])");
    } else if (type === 'heatmap') {
      py.globals.set('args_in', JSON.stringify(payload));
      result = py.runPython("_a = json.loads(args_in)\nheatmap(_a['level'], _a['sheet'])");
    } else if (type === 'simulate') {
      py.globals.set('args_in', JSON.stringify(payload));
      result = py.runPython("_a = json.loads(args_in)\nsimulate(_a['level'], json.dumps(_a['shocks']))");
    } else {
      throw Error('알 수 없는 요청: ' + type);
    }
    postMessage({ id, ok: true, result: JSON.parse(result) });
  } catch (error) {
    postMessage({ id, ok: false, error: String(error && error.message || error) });
  }
}

onmessage = (e) => { chain = chain.then(() => handle(e.data)); };
