let counter = 0;

/** An id for something the form makes before the server knows it. */
export const newId = () => `n${Date.now().toString(36)}${(counter++).toString(36)}`;
