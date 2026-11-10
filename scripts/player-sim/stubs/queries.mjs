export const cache = new Map();
export const queryClient = { getQueryData: (key) => cache.get(JSON.stringify(key)) };
