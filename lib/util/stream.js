const { Transform } = require('stream');

const mapStream = (f) => new Transform({
  objectMode: true,
  transform(row, _, done) {
    this.push(f(row));
    done();
  }
});

module.exports = { mapStream };

