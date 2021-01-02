// Copyright 2018 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { Readable } = require('stream');
const hparser = require('htmlparser2');
const { SchemaStack } = require('./schema');
const { noop } = require('../util/util');

// reads submission xml with the streaming parser, and outputs a stream of every
// field in the submission. does no processing at all to localize repeat groups,
// etc. it's just a stream of found data values.
//
// !!! !!! WARNING WARNING:
// right now this facility is used only by generateExpectedAttachments, which wants
// to navigate the schema stack ignoring gaps so it can just deal w binary fields.
// if you are reading this thinking to use it elsewhere, you'll almost certainly
// need to work out a sensible way to flag the SchemaStack allowEmptyNavigation boolean
// to false for whatever you are doing.
const submissionXmlToFieldStream = (fields, xml) => {
  const outStream = new Readable({ objectMode: true, read: noop });

  const stack = new SchemaStack(fields, true);
  let textBuffer = ''; // agglomerates text nodes that come as multiple events.
  const parser = new hparser.Parser({
    onopentag: (name) => {
      const field = stack.push(name);
      if (field != null) { textBuffer = ''; }
    },
    ontext: (text) => {
      textBuffer += text;
    },
    onclosetag: () => {
      const field = stack.pop();

      if (textBuffer !== '') {
        if ((field != null) && !field.isStructural()) // don't output useless whitespace
          outStream.push({ field, text: textBuffer });
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

module.exports = { submissionXmlToFieldStream };

