// Test order is very important, so if this test fails then the whole suite may
// be doing unexpected things.

describe('3000-test-last', () => {
  it('should NOT be run first', () => {
    // expect
    assert.equal(global.firstHasBeenRun, true);
  });

  it('should be LAST run', function() {
    // FIXME work out some way to test this
  });
});
