interface Window {
  scout: {
    request(
      route: string,
      method: string,
      body?: unknown,
    ): Promise<[number, { error?: string; fields?: Record<string, string> }?]>;
  };
}
