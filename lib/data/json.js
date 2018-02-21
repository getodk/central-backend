const hparser = require('htmlparser2');
const { last, zip } = require('ramda');
const { shasum } = require('../util/util');
const { stripNamespacesFromPath } = require('../util/xml');

// compares fieldStack to a target tablename and returns whether we are:
// out of (-1), at (0), or in (1) our target branch.
const getBranchState = (fieldStack, table) => {
  const impliedTableName = fieldStack.map((field) => field.name).join('-');
  return (impliedTableName === table) ? 0 :
    (impliedTableName.startsWith(table)) ? 1 :
    -1;
};

// rename ramda last to "ptr" to be more descriptive.
const ptr = last;

// pushes the current stackptr back into the stack.
const pushPtr = (stack) => stack.push(ptr(stack));

// given a stack of [ [ field, iteration ], … ] returns a hashid.
const hashId = (stack) => shasum(stack.map(([ field, iteration ]) => `${field.name}#${iteration}`).join('%%'));

// manually extracts fields from a row into a js obj given a schema fieldlist.
const extractFields = (fields, table, submission) => new Promise((resolve) => {
  // we track result separately from our tree/stack-state below. we only push to
  // result when it is actually a result, but we always build the whole structure
  // so that we track iteration counts correctly for idhash stability.
  const result = [];

  // we will simply iterate up and down our schema tree along with the xml, so
  // we will keep a stack of our nested field contexts. it's a rudimentary
  // state machine of sorts.
  // * fieldStack tracks our position in the schema tree.
  // * dataStack tracks our position in the output json.
  // * iterationStack tracks our iterationcount in fieldStack-space (repeats and groups).
  const fieldStack = [{ name: 'Submissions', children: fields }];
  const dataStack = [{ __id: submission.instanceId }];
  const iterationStack = [ submission.instanceId ];

  // we always return an array result, but if we want to return the root record
  // we won't have a repeat step-in to seed the one record we'll return. so if
  // that's the case, do some shuffling here and now.
  if (table === 'Submissions') result.push(ptr(dataStack));

  // now spin up our XML parser and let its SAX-like tree events drive our traversal.
  let droppedWrapper = false;
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
        // we have a schema definition for this field, so we care about it. update
        // our field stack and pointer state, then deal with the result munging.
        const field = fieldPtr.children[name];
        fieldStack.push(field);

        // the data and iteration stacks are handled variously by field type:
        if (field.type === 'structure') {
          // for structures, initialize an object if we haven't yet, then navigate into it.
          const dataPtr = ptr(dataStack);
          if (dataPtr[name] == null) dataPtr[name] = {};
          dataStack.push(dataPtr[name]);

          // structures are part of the navigation stack but don't have iterations, so
          // just assign an empty string.
          iterationStack.push('');
        } else if (field.type === 'repeat') {
          // verify that we have an array to push into in our data obj.
          const dataPtr = ptr(dataStack);
          if (dataPtr[name] == null) dataPtr[name] = [];

          // update iterationStack no matter what, for stable hashing.
          iterationStack.push(dataPtr[name].length);

          // create our new databag, push into result data, and set it as our result ptr.
          // save off contextStack in case we need it below.
          const contextStack = zip(fieldStack, iterationStack);
          const bag = { __id: hashId(contextStack) };
          dataPtr[name].push(bag);
          dataStack.push(bag);

          // if we have exactly reached our target table branch, push our new iteration
          // to the final result and attach a parent id reference.
          if (getBranchState(fieldStack, table) === 0) {
            result.push(bag);

            // leverage the zipped contextStack we already have; drop one entry, then
            // continue dropping until we get the next repeat.
            do contextStack.pop();
              while ((contextStack.length > 0) && (ptr(contextStack)[0].type !== 'repeat'));

            // now push the relevant id.
            if (contextStack.length === 0)
              bag['__Submission-id'] = submission.instanceId;
            else
              bag[`__${contextStack.map((ctx) => ctx[0].name).join('-')}-id`] = hashId(contextStack);
          }
        } else {
          // for primitive fields, we iterate in-place; the value should be written into
          // the current pointer position.
          pushPtr(dataStack);
          pushPtr(iterationStack);
        }
      } else {
        // if we don't have a schema definition for this field, simply navigate into
        // nothing; we still push stack state to track tree depth.
        fieldStack.push(null);
        dataStack.push(null);
        iterationStack.push(null);
      }
    },
    ontext: (text) => {
      const fieldPtr = ptr(fieldStack);
      if ((fieldPtr != null) && (fieldPtr.name != null)) {
        if (getBranchState(fieldStack, table) === 1) {
          const dataPtr = ptr(dataStack);
          // we have a value and a place to put it. preprocess it if necessary and write.
          if (fieldPtr.type === 'int') {
            dataPtr[fieldPtr.name] = parseInt(text);
          } else if (fieldPtr.type === 'decimal') {
            dataPtr[fieldPtr.name] = parseFloat(text);
          } else if (fieldPtr.type === 'geopoint') {
            const [ lat, lon, altitude ] = text.split(/\s+/g).map(parseFloat);
            if (Number.isNaN(lat) || Number.isNaN(lon)) return;
            const geopoint = { type: 'Point', coordinates: [ lon, lat ] };
            if (!Number.isNaN(altitude)) geopoint.coordinates.push(altitude);
            dataPtr[fieldPtr.name] = geopoint;
          } else {
            dataPtr[fieldPtr.name] = text;
          }
        }
      }
    },
    onclosetag: (name) => {
      // popstack. if we are left without a root fieldPtr, we are at the end of submission.
      fieldStack.pop();
      dataStack.pop();
      iterationStack.pop();

      if (fieldStack.length === 0) {
        parser.reset();
        resolve(result);
      }
    }
  }, { xmlMode: true });
  parser.write(submission.xml);
});

module.exports = { extractFields };

