// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Readable } = require('stream');
const hparser = require('htmlparser2');
const { last } = require('ramda');
const ptr = last; // just an alias.
const { schemaAsLookup, stripNamespacesFromSchema } = require('./schema');
const { stripNamespacesFromPath } = require('../util/xml');
const { noop } = require('../util/util');

// reads submission xml with the streaming parser, and outputs a stream of every
// field in the submission. does no processing at all to localize repeat groups,
// etc. it's just a stream of found data values.
const submissionXmlToFieldStream = (xml, xform) => xform.schema().then((schema) => {
  const lookup = schemaAsLookup(stripNamespacesFromSchema(schema));
  const outStream = new Readable({ objectMode: true, read: noop });

  const fieldStack = [{ children: lookup }];
  let droppedWrapper = false;
  let textBuffer = ''; // agglomerates text nodes that come as multiple events.
  const parser = new hparser.Parser({
    onopentag: (fullname) => {
      // drop the root xml tag.
      if (droppedWrapper === false) {
        droppedWrapper = true;
        return;
      }

      const name = stripNamespacesFromPath(fullname);
      const fieldPtr = ptr(fieldStack);
      if ((fieldPtr != null) && (fieldPtr.children[name] != null)) {
        // we have a schema definition for this field. update state as appropriate.
        const field = fieldPtr.children[name];
        fieldStack.push(field);
        textBuffer = '';
      } else {
        fieldStack.push(null);
      }
    },
    ontext: (text) => {
      textBuffer += text;
    },
    onclosetag: () => {
      const field = fieldStack.pop();

      if (textBuffer !== '') {
        if (field.children == null) // don't output useless whitespace
          outStream.push({ field, text: textBuffer });
        textBuffer = '';
      }

      if (fieldStack.length === 0) {
        parser.reset();
        outStream.push(null);
      }
    }
  }, { xmlMode: true, decodeEntities: true });
  parser.write(xml);

  return outStream;
});

module.exports = { submissionXmlToFieldStream };

