// What a field of the snapshot accepts while it is typed: nothing outside what the server takes (SPEC-021 RN-12).

/** A permission is made of 3 or 4 digits from 0 to 7: anything else is dropped as it is typed (888, abc and 8888 never get in). */
export const octalMode = (value: string) => value.replace(/[^0-7]/g, "").slice(0, 4);

/** A user or group name: lower case letters, digits, "_" and "-", not starting with a digit or "-", up to 32 characters. */
export const accountName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^[0-9-]+/, "")
    .slice(0, 32);

/** A permission that is complete: 3 or 4 digits. An empty one is fine (the file keeps its own). */
export const isCompleteMode = (value: string) => value === "" || /^[0-7]{3,4}$/.test(value);
