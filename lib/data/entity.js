// Copyright 2022 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const csv = require('csv-stringify');
const hparser = require('htmlparser2');
const { Readable, Transform } = require('stream');
const { PartialPipe } = require('../util/stream');
const { SchemaStack } = require('./schema');
const { noop } = require('../util/util');

////////////////////////////
// ENTITY PARSING
//
// Parse submission XML and use with form field -> entity property mappings to build entities.

const submissionXmlToEntityStream = (fields, xml) => {
  const outStream = new Readable({ objectMode: true, read: noop });

  const stack = new SchemaStack(fields, true);
  let textBuffer = ''; // agglomerates text nodes that come as multiple events.
  const parser = new hparser.Parser({
    onopentag: (name, attrs) => {
      const field = stack.push(name);
      if (field != null) {
        const head = stack.head();
        if (head != null && attrs !== {} && head.isStructural()) {
          outStream.push({ field: { ...head, attrs }, text: null });
        }
        textBuffer = '';
      }
    },
    ontext: (text) => {
      textBuffer += text;
    },
    onclosetag: () => {
      const field = stack.pop();

      if (textBuffer !== '') {
        if (field != null) {
          if (!field.isStructural()) // don't output useless whitespace
            outStream.push({ field, text: textBuffer });
        }
        textBuffer = '';
      }

      if (stack.hasExited()) {
        parser.reset();
        outStream.push(null);
      }
    }
  }, { xmlMode: true, decodeEntities: true });

  parser.write(xml);
  parser.end();

  return outStream;
};

// n.b. this wants only entity fields with filled in propertyName attribute!
const getEntity = (entityFields, xml) => new Promise((resolve, reject) => {
  const entity = { system: {}, data: {} };
  const stream = submissionXmlToEntityStream(entityFields, xml);
  stream.on('error', reject);
  stream.on('data', ({ field, text }) => {
    if (field.name === 'entity' && field.attrs !== {}) {
      entity.system.dataset = field.attrs.dataset;
    } else if (field.path.indexOf('/meta/entity') === 0)
      entity.system[field.name] = text;
    else if (field.propertyName != null)
      entity.data[field.propertyName] = text;
  });
  stream.on('end', () => resolve(entity));
});

/// Outputting entities

const formatRow = (entity, props) => {
  const out = [];
  out.push(entity.uuid);
  out.push(entity.label);
  for (const prop of props) out.push(entity.def.data[prop]);
  return out;
};

const streamEntityCsvs = (inStream, properties) => {
  const header = [ 'name', 'label' ];
  const props = [];

  for (let idx = 0; idx < properties.length; idx += 1) {
    const field = properties[idx];
    const prop = field.name;
    header.push(prop);
    props.push(prop);
  }

  let rootHeaderSent = false;
  const rootStream = new Transform({
    objectMode: true,
    transform(entity, _, done) {
      try {
        if (rootHeaderSent === false) {
          this.push(header);
          rootHeaderSent = true;
        }
        this.push(formatRow(entity, props));
        done();
      } catch (ex) { done(ex); }
    }, flush(done) {
      if (rootHeaderSent === false) this.push(header);
      done();
    }
  });

  return PartialPipe.of(inStream, rootStream, csv());
};


module.exports = { getEntity, streamEntityCsvs };
