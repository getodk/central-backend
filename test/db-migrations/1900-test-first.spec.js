// Test order is very important, so if this test fails then the whole suite may
// be doing unexpected things.

describe('1900-test-first', () => {
  after(() => {
    global.firstHasBeenRun = true;
  });

  it('should be run first', () => {
    // expect
    assert.equal(global.firstHasBeenRun, undefined);
  });
});
