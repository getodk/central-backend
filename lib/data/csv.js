const { Readable, Transform } = require('stream');
const { merge, dropLast, last } = require('ramda');
const sanitize = require('sanitize-filename');
const { toTraversable, traverseFirstChild } = require('../util/xml');
const { convertToJson } = require('fast-xml-parser');
const { incr, get, ensureArray } = require('../util/util');
const csv = require('csv-stringify');
const { zipPart } = require('./zip');
const { getFormSchema, flattenSchemaStructures } = require('./schema');

const _requiredIdFields = (idFields, fields) => {
  // top-level instanceID is outputted via bind.
  if (idFields.length === 1) return [];
  // if no repeats are in this table, then its own rows do not require ids.
  if (fields.every((field) => field.type !== 'repeat') === true) return dropLast(1, idFields);
  // default behaviour.
  return idFields;
};

const _tableStreamer = (archive, filenameParts, idFields, fields) => {
  const outStream = csv();
  archive.append(outStream, { name: `${sanitize(filenameParts.join('-'))}.csv` });

  // we will only be serializing this table's fields in this table, so we only
  // write non-repeat field names as the column header.
  const allFields = _requiredIdFields(idFields, fields).concat(fields);
  const directFields = allFields.filter((field) => field.type !== 'repeat');
  outStream.write(directFields.map((field) => last(field.path)));

  const genId = incr();
  const substreams = {};
  const transformer = new Transform({
    objectMode: true,
    transform(inRowParam, _, done) {
      const inRow = inRowParam; // make the linter happy
      const outRow = [];

      // inject our rowID, unless we are the top-level in which case it is guaranteed.
      if (idFields.length > 1) inRow[last(idFields).path[0]] = genId();

      for (const field of allFields) {
        if (field.type === 'repeat') {
          // if we are a repeat, we will be formatting and passing this row to a
          // substream rather than processing it ourselves. but we may have to
          // create that substream first:
          const substreamId = field.path.join('-');
          if (substreams[substreamId] == null) {
            // if we need a substream, we create a input stream we can push the
            // subrows into, and feed that into a recursive table streamer. we
            // want to end the substream when this stream ends.
            const substream = new Readable({ read() {}, objectMode: true });
            substreams[substreamId] = substream;
            const substreamIdFields = idFields.concat([{ path: [ `${substreamId}ID` ], type: 'string' }]);
            substream.pipe(_tableStreamer(archive, filenameParts.concat(field.path), substreamIdFields, field.children));
            outStream.on('end', () => substream.push(null));
          }

          // whether we created a substream or we already had one, we now want
          // to go through each subrow and push it into that substream. we also
          // do some work to copy our stack of row identifiers into the subrow
          // data.
          const value = get(inRow, field.path);
          if (value != null) {
            for (const subrow of ensureArray(value)) {
              // TODO: this block is an inefficient and ugly mess.
              for (const idField of idFields)
                subrow[idField.path[0]] = inRow[idField.path[0]];
              subrow.instanceID = inRow.instanceID || inRow['@_instanceID'];
              substreams[substreamId].push(subrow);
            }
          }
        } else {
          // we have a primitive value of some kind; simply push it into the
          // output csv as-is.
          outRow.push(get(inRow, field.path));
        }
      }
      this.push(outRow);
      done();
    }
  });

  transformer.pipe(outStream);
  return transformer;
};

const instanceIDField = { path: [ 'instanceID' ], type: 'string' };
const streamJoinedCsvs = (inStream, form) => {
  const archive = zipPart();

  // this simple transform stream turns postgres rows into plain js data bags.
  const parserStream = new Transform({
    objectMode: true,
    transform(row, _, done) {
      // parse and send the simplified row data down the stream, with the instanceID included
      // as a fake xml attribute so it doesn't clobber anything:
      this.push(merge(
        convertToJson(traverseFirstChild(toTraversable(row.xml))),
        { '@_instanceID': row.instanceId }
      ));
      done(); // signifies that this stream element is fully processed.
    }
  });

  // set up the top-level table streamer that accepts data from the above transform.
  const fileBasename = [ form.xmlFormId ]; // TODO: sanitization?
  const schema = flattenSchemaStructures(getFormSchema(form));
  const outStream = _tableStreamer(archive, fileBasename, [ instanceIDField ], schema);

  // finally wire it all together.
  inStream.pipe(parserStream).pipe(outStream);
  outStream.on('end', () => archive.finalize());
  return archive;
};

module.exports = { streamJoinedCsvs };

