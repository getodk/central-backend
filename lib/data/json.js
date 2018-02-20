const hparser = require('htmlparser2');
const { shasum } = require('../util/util');
const { stripNamespacesFromPath } = require('../util/xml');

// manually extracts fields from a row into a js obj given a schema fieldlist.
const extractFields = (fields, table, submission) => new Promise((resolve) => {
  // we will simply iterate up and down our schema tree along with the xml, so
  // we will keep a stack of our nested field contexts. it's a rudimentary
  // state machine of sorts.
  // * resultStack tracks our position in the output json.
  // * fieldStack tracks our position in the schema tree.
  // * tableStack tracks our position in tablespace (ie repeat nestings).
  const result = {};
  const resultStack = [];
  let resultPtr = result;

  const fieldStack = [];
  let fieldPtr = { children: fields };

  const tableStack = [];
  let tablePtr = { name: 'Submission', iteration: submission.instanceId };

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
        // we have a schema definition for this field, so we care about it. update
        // our field stack and pointer state, then deal with the result munging.
        const field = fieldPtr.children[name];
        fieldStack.push(fieldPtr);
        fieldPtr = field;

        // the result stack and pointer are handled variously by field type:
        if (field.type === 'structure') {
          // for structures, initialize an object if we haven't yet, then navigate into it.
          if (resultPtr[name] == null) resultPtr[name] = {};

          resultStack.push(resultPtr);
          resultPtr = resultPtr[name];
        } else if (field.type === 'repeat') {
          // for repeats, initialize an array if it's not there, then push a new object
          // into it and navigate into that object. assign a sequential __id.
          if (resultPtr[name] == null) resultPtr[name] = [];
          resultStack.push(resultPtr);

          // push table state, as stepping into a repeat means stepping into a subtable.
          tableStack.push(tablePtr);
          tablePtr = { name: fieldPtr.name, iteration: resultPtr[name].length };

          // create our new databag, push into result data, and set it as our result ptr.
          const uniqueId = tableStack.concat([ tablePtr ])
            .map((table) => `${table.name}#${table.iteration}`)
            .join('%%');
          const bag = { __id: shasum(uniqueId) };
          resultPtr[name].push(bag);
          resultPtr = bag;
        } else {
          // for primitive fields, we do nothing; the value should be written into the
          // current pointer position.
          resultStack.push(resultPtr);
        }
      } else {
        // if we don't have a schema definition for this field, simply navigate into
        // nothing; we still push stack state to track tree depth.
        fieldStack.push(fieldPtr);
        fieldPtr = null;
        resultStack.push(resultPtr);
        resultPtr = null;
      }
    },
    ontext: (text) => {
      if ((fieldPtr != null) && (fieldPtr.name != null)) {
        // we have a value and a place to put it. preprocess it if necessary and write.
        if (fieldPtr.type === 'int')
          resultPtr[fieldPtr.name] = parseInt(text);
        else if (fieldPtr.type === 'decimal')
          resultPtr[fieldPtr.name] = parseFloat(text);
        else
          resultPtr[fieldPtr.name] = text;
      }
    },
    onclosetag: (name) => {
      // attempt to popstack. if we can't, we must be at the end of the submission.
      if (fieldStack.length === 0) {
        parser.reset();
        resolve(result);
      } else {
        if ((fieldPtr !== null) && (fieldPtr.type === 'repeat'))
          // only in this case step back out of a table.
          tablePtr = tableStack.pop();
        fieldPtr = fieldStack.pop();
        resultPtr = resultStack.pop();
      }
    }
  }, { xmlMode: true });
  parser.write(submission.xml);
});

module.exports = { extractFields };

