import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { UIProvider } from '../../src/store/UIContext.jsx';
import { ITEMS, USERS, TEAMS, ORG, ME } from '../../src/data/mockData.js';

/** Server-render a component inside the router + UI context the app normally provides. */
export const render = (el) => renderToStaticMarkup(<MemoryRouter><UIProvider>{el}</UIProvider></MemoryRouter>);

/** A store-shaped state built from the sample data (enough for the selectors). */
export function mockState(overrides = {}) {
  const items = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
  return { items, users: USERS, teams: TEAMS, org: ORG, meId: ME, audit: [], ...overrides };
}

export const itemNamed = (name) => ITEMS.find((i) => i.name === name);
