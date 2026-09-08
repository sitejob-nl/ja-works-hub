const PORTAL_HOME = '/portaal';

/** Login may return to a portal route, never to another origin or auth flow. */
export function getPortalReturnPath(value: string | null | undefined): string {
  if (!value || /[\\\s#]/.test(value)
    || [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    return PORTAL_HOME;
  }

  const pathname = value.split('?', 1)[0];
  // Portal route parameters are plain IDs. Excluding escapes and dot segments also
  // prevents browsers or routers from normalizing the path outside this prefix.
  if (!/^\/portaal(?:\/[A-Za-z0-9_-]+)*\/?$/.test(pathname)) return PORTAL_HOME;
  if (/^\/portaal\/(?:login|activeren)(?:\/|$)/.test(pathname)) return PORTAL_HOME;

  return value;
}

export function getPortalLoginPath(pathname: string, search = ''): string {
  const returnTo = getPortalReturnPath(`${pathname}${search}`);
  return `/portaal/login?${new URLSearchParams({ returnTo }).toString()}`;
}
