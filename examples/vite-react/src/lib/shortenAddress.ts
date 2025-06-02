export const shortenAddress = (
  address: string,
  startLength = 8,
  endLength = 8,
) => {
  if (address.length <= startLength + endLength) {
    return address;
  }
  return `${address.slice(0, startLength)}…${address.slice(-endLength)}`;
};
