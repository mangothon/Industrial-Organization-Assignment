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

// 화면에서 부를 수 있는 model.py 함수 → 인자 순서
const FUNCTIONS = {
  explore: ['level', 'sheet', 'axis', 'key'],
  profile: ['level', 'sheet', 'code'],
  top_links: ['level', 'sheet'],
  sheet_axes: ['level', 'sheet'],
  compare: ['level', 'sheet', 'payload'],
  structure: ['level'],
  linkage: ['level'],
  employment_view: [],
  simulate: ['level', 'payload'],
};

async function handle({ id, type, payload }) {
  try {
    let result;
    if (type === 'load') {
      await boot();
      const out = {};
      if (payload.classification) {
        setBytes('class_bytes', payload.classification);
        out.classification = JSON.parse(py.runPython('_r = load_classification(class_bytes)\ndel class_bytes\n_r'));
      }
      step(3, 'Excel 읽기와 계수 검증 중…');
      if (payload.summary) {
        setBytes('summary_bytes', payload.summary);
        out.summary = JSON.parse(py.runPython('_r = load_summary(summary_bytes)\ndel summary_bytes\n_r'));
      }
      setBytes('raw_bytes', payload.buffer);
      py.globals.set('level_in', payload.level);
      py.globals.set('n_in', payload.n);
      out.data = JSON.parse(py.runPython('_r = initialize(level_in, raw_bytes, n_in)\ndel raw_bytes\n_r'));
      out.empCheck = JSON.parse(py.runPython('verify_employment()'));
      postMessage({ id, ok: true, result: out });
      return;
    }
    const names = FUNCTIONS[type];
    if (!names) throw Error('알 수 없는 요청: ' + type);
    py.globals.set('args_in', JSON.stringify(names.map((k) => (k === 'payload' ? JSON.stringify(payload[k]) : payload[k]))));
    result = py.runPython(`${type}(*json.loads(args_in))`);
    postMessage({ id, ok: true, result: JSON.parse(result) });
  } catch (error) {
    postMessage({ id, ok: false, error: String(error && error.message || error) });
  }
}

onmessage = (e) => { chain = chain.then(() => handle(e.data)); };
