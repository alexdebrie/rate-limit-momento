/**
 * Returns the start time of a fixed-size window of a given duration.
 * @param {Object} options - The options for the window.
 * @param {Date} [options.timestamp=new Date()] - The timestamp to use for the current time. Defaults to the current system time.
 * @param {number} options.numSeconds - The duration of the window, in seconds.
 * @returns {Date} - The start time of the window.
 */
const timestampToWindow = ({ timestamp = new Date(), numSeconds }) => {
  return new Date(
    Math.floor(timestamp.getTime() / (numSeconds * 1000)) * numSeconds * 1000
  );
};

/**
 * Returns an array of all time windows between a start and end time, given a fixed window size in seconds.
 *
 * @param {Object} options - The options for the time windows.
 * @param {Date} options.startTime - The start time for the time windows.
 * @param {Date} [options.endTime=new Date()] - The end time for the time windows. Defaults to the current system time.
 * @param {number} options.numSeconds - The duration of each time window, in seconds.
 * @returns {Array.<Date>} - An array of Date objects representing the start time of each time window.
 * @throws {Error} - Throws an error if the `startTime` property is not provided in the options object.
 */
function getTimeWindows({ startTime, endTime = new Date(), numSeconds }) {
  if (!startTime) {
    throw new Error("Must provide a start time in getTimeWindows");
  }
  const startWindow = timestampToWindow({ timestamp: startTime, numSeconds });
  const endWindow = timestampToWindow({ timestamp: endTime, numSeconds });
  const windows = [];
  for (
    let time = startWindow.getTime();
    time <= endWindow.getTime();
    time += numSeconds * 1000
  ) {
    windows.push(new Date(time));
  }
  return windows;
}

export { timestampToWindow, getTimeWindows };
