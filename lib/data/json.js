const hparser = require('htmlparser2');
const { stripNamespacesFromPath } = require('../util/xml');

// manually extracts fields from a row into a js obj given a schema fieldlist.
const extractFields = (fields, submission) => new Promise((resolve) => {
  // we will simply iterate up and down our schema tree along with the xml, so
  // we will keep a stack of our nested field contexts. it's a rudimentary
  // state machine of sorts.
  const fieldStack = [];
  let fieldPtr = { children: fields };

  const result = {};
  const resultStack = [];
  let resultPtr = result;

  let droppedWrapper = false;
  const parser = new hparser.Parser({
    onopentag: (fullname) => {
      const name = stripNamespacesFromPath(fullname);
      // drop the root xml tag.
      if (droppedWrapper === false) {
        droppedWrapper = true;
        return;
      }

      if ((fieldPtr != null) && (fieldPtr.children[name] != null)) {
        const field = fieldPtr.children[name];
        fieldStack.push(fieldPtr);
        fieldPtr = field;

        if (field.type === 'structure') {
          resultPtr[name] = {};
          resultStack.push(resultPtr);
          resultPtr = resultPtr[name];
        } else if (field.type === 'repeat') {
          if (resultPtr[name] == null)
            resultPtr[name] = [];

          resultStack.push(resultPtr);
          const bag = {};
          resultPtr[name].push(bag);
          resultPtr = bag;
        } else {
          resultStack.push(resultPtr);
        }
      } else {
        fieldStack.push(fieldPtr);
        fieldPtr = null;
        resultStack.push(resultPtr);
        resultPtr = null;
      }
    },
    ontext: (text) => {
      if ((fieldPtr != null) && (fieldPtr.name != null)) {
        if (fieldPtr.type === 'int')
          resultPtr[fieldPtr.name] = parseInt(text);
        else if (fieldPtr.type === 'decimal')
          resultPtr[fieldPtr.name] = parseFloat(text);
        else
          resultPtr[fieldPtr.name] = text;
      }
    },
    onclosetag: (name) => {
      if (fieldStack.length === 0) {
        parser.reset();
        resolve(result);
      } else {
        fieldPtr = fieldStack.pop();
        resultPtr = resultStack.pop();
      }
    }
  }, { xmlMode: true });
  parser.write(submission.xml);
});

module.exports = { extractFields };

