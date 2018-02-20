const hparser = require('htmlparser2');
const { zip } = require('ramda');
const { shasum } = require('../util/util');
const { stripNamespacesFromPath } = require('../util/xml');

// compares fieldStack to a target tablename and returns whether we are:
// off (-2), before (-1), at (0), or in (1) our target branch.
const getBranchState = (fieldStack, table) => {
  const impliedTableName = fieldStack.map((field) => field.name).join('-');
  return (impliedTableName === table) ? 0 :
    (impliedTableName.startsWith(table)) ? 1 :
    (table.startsWith(impliedTableName)) ? -2 :
    -1;
};

// manually extracts fields from a row into a js obj given a schema fieldlist.
const extractFields = (fields, table, submission) => new Promise((resolve) => {
  // we will simply iterate up and down our schema tree along with the xml, so
  // we will keep a stack of our nested field contexts. it's a rudimentary
  // state machine of sorts.
  // * dataStack tracks our position in the output json.
  // * fieldStack tracks our position in the schema tree.
  // * iterationStack tracks our iterationcount in fieldStack-space (repeats and groups).
  const result = [];

  const root = { __id: submission.instanceId };
  const dataStack = [];
  let dataPtr = root;

  const fieldStack = [];
  let fieldPtr = { name: 'Submissions', children: fields };

  const iterationStack = [];
  let iterationPtr = submission.instanceId;

  // we always return an array result, but if we want to return the root record
  // we won't have a repeat step-in to seed the one record we'll return. so if
  // that's the case, do some shuffling here and now.
  if (table === 'Submissions') result.push(dataPtr);

  // now spin up our XML parser and let its SAX-like tree events drive our traversal.
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

        // always push dataPtr and iterationPtr to their stacks. what we assign
        // the new ptrs to varies by branch below.
        dataStack.push(dataPtr);
        iterationStack.push(iterationPtr);

        // compute our branchstate as we may need it below.
        const branchState = getBranchState(fieldStack.concat([ field ]), table);

        // the result stack and pointer are handled variously by field type:
        if (field.type === 'structure') {
          // for structures, initialize an object if we haven't yet, then navigate into it.
          if (dataPtr[name] == null) dataPtr[name] = {};
          dataPtr = dataPtr[name];

          // structures are part of the navigation stack but don't have iterations, so
          // just assign an empty string.
          iterationPtr = '';
        } else if (field.type === 'repeat') {
          // verify that we have an array to push into in our data obj.
          if (dataPtr[name] == null) dataPtr[name] = [];

          // update iterationPtr no matter what, for stable hashing.
          iterationPtr = dataPtr[name].length;

          // create our new databag, push into result data, and set it as our result ptr.
          const uniqueId = zip(fieldStack, iterationStack)
            .concat([ [ fieldPtr, iterationPtr ] ])
            .map(([ field, iteration ]) => `${field.name}#${iteration}`)
            .join('%%');
          const bag = { __id: shasum(uniqueId) };
          dataPtr[name].push(bag);
          dataPtr = bag;

          // if we have exactly reached our target table branch, push our new iteration
          // to the final result.
          if (branchState === 0) result.push(dataPtr);
        } else {
          // for primitive fields, we do nothing; the value should be written into the
          // current pointer position.
        }
      } else {
        // if we don't have a schema definition for this field, simply navigate into
        // nothing; we still push stack state to track tree depth.
        fieldStack.push(fieldPtr);
        dataStack.push(dataPtr);
        iterationStack.push(iterationPtr);

        // setting fieldPtr to null will cause this branch to be discarded.
        fieldPtr = null; 
      }
    },
    ontext: (text) => {
      if ((fieldPtr != null) && (fieldPtr.name != null)) {
        if (getBranchState(fieldStack.concat([ fieldPtr ]), table) === 1) {
          // we have a value and a place to put it. preprocess it if necessary and write.
          if (fieldPtr.type === 'int')
            dataPtr[fieldPtr.name] = parseInt(text);
          else if (fieldPtr.type === 'decimal')
            dataPtr[fieldPtr.name] = parseFloat(text);
          else
            dataPtr[fieldPtr.name] = text;
        }
      }
    },
    onclosetag: (name) => {
      // attempt to popstack. if we can't, we must be at the end of the submission.
      if (fieldStack.length === 0) {
        parser.reset();
        resolve(result);
      } else {
        fieldPtr = fieldStack.pop();
        dataPtr = dataStack.pop();
        iterationPtr = iterationStack.pop();
      }
    }
  }, { xmlMode: true });
  parser.write(submission.xml);
});

module.exports = { extractFields };

