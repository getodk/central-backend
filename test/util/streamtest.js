const {
  fromChunks,
  fromObjects,
  toObjects,
  toText,
} = require('streamtest').default;

const withOldApi = fn => callback => {
  const [ outputStream, resultP ] = fn();
  resultP.then(result => callback(null, result)).catch(callback);
  return outputStream;
};

module.exports = {
  fromChunks,
  fromObjects,
  toObjects: withOldApi(toObjects),
  toText: withOldApi(toText),
};
