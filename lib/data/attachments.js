const { join } = require('path');
const { zipPart } = require('./zip');

const streamAttachments = (inStream) => {
  const archive = zipPart();

  inStream.on('data', ({ instanceId, name, content }) =>
    archive.append(content, { name: join('files', instanceId, name) }));
  inStream.on('end', () => archive.finalize());

  return archive;
};

module.exports = { streamAttachments };

