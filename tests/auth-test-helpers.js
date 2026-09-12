const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadModule(relativePath, dependencies, globals = {}) {
  const filename = path.join(__dirname, '..', relativePath);
  const module = { exports: {} };
  const logs = [];
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    __filename: filename,
    __dirname: path.dirname(filename),
    console: {
      error: (...args) => logs.push(args),
      log: (...args) => logs.push(args),
    },
    process: { env: {} },
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    ...globals,
  }, { filename });
  return { exports: module.exports, logs };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    getHeader(key) { return this.headers[key]; },
    status(value) { this.statusCode = value; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; },
  };
}

function json(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { loadModule, response, json };
