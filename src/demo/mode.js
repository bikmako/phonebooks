export const isDemo = import.meta.env?.MODE === 'demo';

export function publicDemoOrigin(value) {
  if (!value) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'phonebooks-demo-staging.onrender.com' || url.href !== url.origin + '/') {
    throw new Error('PhoneBooks Demo requires its dedicated staging HTTPS origin.');
  }
  return url.origin;
}

export function demoUrls(origin) {
  return origin ? { solo: origin + '/solo/', team: origin + '/team/' } : {
    solo: 'http://localhost:4497/', team: 'http://127.0.0.1:4498/',
  };
}

const urls = demoUrls(isDemo ? publicDemoOrigin(import.meta.env.VITE_PHONEBOOKS_DEMO_ORIGIN) : '');
export const demoSoloUrl = urls.solo;
export const demoTeamUrl = urls.team;

export function isDemoEntry(location, expected) {
  const url = new URL(expected);
  return location.origin === url.origin && location.pathname === url.pathname;
}
