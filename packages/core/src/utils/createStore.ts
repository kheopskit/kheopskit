import { BehaviorSubject, filter, fromEvent, map } from "rxjs";

export const createStore = <T>(key: string, defaultValue: T) => {
  const subject = new BehaviorSubject<T>(getStoredData(key, defaultValue));

  // Cross-tab sync via 'storage' event (won't fire if key is updated from same tab)
  fromEvent<StorageEvent>(window, "storage")
    .pipe(
      filter((event) => event.key === key),
      map((event) => parseData(event.newValue, defaultValue)),
    )
    .subscribe((newValue) => subject.next(newValue));

  const update = (val: T) => {
    setStoredData(key, val);
    subject.next(val);
  };

  return {
    observable: subject.asObservable(),
    set: (val: T) => update(val),
    mutate: (transform: (prev: T) => T) =>
      update(transform(subject.getValue())),
    get: () => structuredClone(subject.getValue()),
  };
};

const parseData = <T>(str: string | null, defaultValue: T): T => {
  try {
    if (str) return JSON.parse(str);
  } catch {
    // invalid data
  }
  return defaultValue;
};

const getStoredData = <T>(key: string, defaultValue: T): T => {
  const str = localStorage.getItem(key);
  return parseData(str, defaultValue);
};

const setStoredData = <T>(key: string, val: T) => {
  const str = JSON.stringify(val);
  localStorage.setItem(key, str);
};
