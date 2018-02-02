const { join } = require('path');
const { zipPart } = require('./zip');
const sanitize = require('sanitize-filename');

const streamAttachments = (inStream) => {
  const archive = zipPart();

  // this sanitization means that two filenames could end up identical.
  // luckily, this is not actually illegal in the zip spec; two files can live at precisely
  // the same location, and the conflict is dealt with interactively by the unzipping client.
  inStream.on('data', ({ instanceId, name, content }) =>
    archive.append(content, { name: join('files', sanitize(instanceId), sanitize(name)) }));
  inStream.on('end', () => archive.finalize());

  return archive;
};

module.exports = { streamAttachments };

