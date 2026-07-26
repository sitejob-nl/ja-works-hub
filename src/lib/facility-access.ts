const UUID_SEGMENT = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const FACILITY_DETAIL_PATH = new RegExp(`^/(?:huisvesting|transport)/${UUID_SEGMENT}/?$`);

export const isFacilityRole = (role: unknown): role is 'facility' => role === 'facility';

export function isFacilityPathAllowed(pathname: string): boolean {
  return pathname === '/huisvesting'
    || pathname === '/huisvesting/'
    || pathname === '/transport'
    || pathname === '/transport/'
    || pathname === '/taken'
    || pathname === '/taken/'
    || FACILITY_DETAIL_PATH.test(pathname);
}
