const hparser = require('htmlparser2');

// simply omits any processing instructions and the outer wrapper,
// then streams the rest of the tags as they come in.
const unwrapSubmission = (submission) => new Promise((resolve) => {
  // use the tokenizer to detect the first open tag's index, use simple character
  // search to find the final closing tag, then brute-force strip them from the
  // original text, and abort the parser so it doesn't process the rest.
  const parser = new hparser.Parser({
    // we simply react to the first open tag, after which the tokenizer pointer
    // will be located at the /end/ of that open tag. drop one character and we
    // will naturally have the contents of that tag.
    onopentag: () => {
      const lastTagStartIdx = submission.xml.lastIndexOf('<');
      resolve(submission.xml.slice(parser._tokenizer._index + 1, lastTagStartIdx));
      parser.reset();
    }
  }, { xmlMode: true });
  parser.write(submission.xml);
});

module.exports = { unwrapSubmission };

