const Module = require('node:module');
const load = Module._load;

Module._load = function (...args) {
  if (args[0] === '@zoveli/host') {
    process.stderr.write('fast-path loaded @zoveli/host\n');
    process.exit(42);
  }
  return load.apply(this, args);
};
