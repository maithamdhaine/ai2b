import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { interventions as defaultInterventions } from './data/interventions';
import { DEFAULT_LANG, copyFor, isLang, type Copy, type Lang } from './i18n';
import { setNotAvailable } from './components/map/format';
import { setFormatLang } from './lib/intl';
import { computePlan } from './lib/planner';
import type {
  Action, FundedProject, Filters, Intervention, Lens, Meta, PlanItem, Profile,
  ServiceCollection, Weights, ZoneCollection,
} from './types';

interface Store {
  zones: ZoneCollection | null;
  services: ServiceCollection | null;
  funded: FundedProject[];
  meta: Meta | null;
  loadError: string | null;

  profile: Profile;
  budget_eur: number;
  weights: Weights;
  filters: Filters;
  selected_zone_id: number | null;
  plan: PlanItem[];
  interventions: Intervention[];
  lens: Lens;
  lang: Lang;
  memoRequest: number; // bumped by write_memo; the memo view watches it

  setLang: (lang: Lang) => void;
  load: () => Promise<void>;
  recompute: () => void;
  setLens: (lens: Lens) => void;
  setProfile: (profile: Profile) => void;
  setBudget: (budget_eur: number) => void;
  setWeights: (weights: Partial<Weights>) => void;
  setFilters: (filters: Partial<Filters>) => void;
  selectZone: (id: number | null) => void;
  setIntervention: (id: string, patch: Partial<Intervention>) => void;
  requestMemo: () => void;
  applyAction: (action: Action) => void;
}

// Starting priorities per funder type. Team assumption; users and the AI can change them.
const profileWeights: Record<Profile, Weights> = {
  foundation: { isolation: 0.4, service_gap: 0.3, future_pressure: 0.2, inclusion: 0.1 },
  third_sector: { isolation: 0.3, service_gap: 0.4, future_pressure: 0.1, inclusion: 0.2 },
  institution: { isolation: 0.25, service_gap: 0.45, future_pressure: 0.1, inclusion: 0.2 },
};

const LANG_KEY = 'bussola.lang';

/** A reload mid-demo must not drop the room back into English. */
function storedLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    return isLang(saved) ? saved : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

export const useStore = create<Store>((set, get) => ({
  zones: null,
  services: null,
  funded: [],
  meta: null,
  loadError: null,

  profile: 'foundation',
  budget_eur: 100000,
  weights: { isolation: 0.4, service_gap: 0.3, future_pressure: 0.2, inclusion: 0.1 },
  filters: { circ: [], exclude_funded: false, min_over75: 0 },
  selected_zone_id: null,
  plan: [],
  interventions: defaultInterventions,
  lens: 'isolation',
  lang: storedLang(),
  memoRequest: 0,

  load: async () => {
    try {
      const get_json = async (f: string) => {
        const r = await fetch(`/data/${f}`);
        if (!r.ok) throw new Error(`${f}: ${r.status}`);
        return r.json();
      };
      const [zones, services, funded, meta] = await Promise.all([
        get_json('zones.geojson'), get_json('services.geojson'),
        get_json('funded.json'), get_json('meta.json'),
      ]);
      set({ zones, services, funded, meta });
      get().recompute();
    } catch (e) {
      set({ loadError: String(e) });
    }
  },

  recompute: () => {
    const { zones, interventions, weights, filters, budget_eur } = get();
    if (!zones) return;
    set({ plan: computePlan(zones.features.map((f) => f.properties), interventions, weights, filters, budget_eur) });
  },

  setLens: (lens) => set({ lens }),
  // Number formats and the "not available" marker are not React state, so they are
  // switched here, next to the language every component re-renders on.
  setLang: (lang) => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      // A blocked store only costs the choice on the next reload.
    }
    setFormatLang(lang);
    setNotAvailable(lang);
    set({ lang });
  },
  setProfile: (profile) => { set({ profile, weights: profileWeights[profile] }); get().recompute(); },
  setBudget: (budget_eur) => { set({ budget_eur: Math.max(0, budget_eur) }); get().recompute(); },
  setWeights: (w) => { set({ weights: { ...get().weights, ...w } }); get().recompute(); },
  setFilters: (f) => { set({ filters: { ...get().filters, ...f } }); get().recompute(); },
  selectZone: (selected_zone_id) => set({ selected_zone_id }),
  setIntervention: (id, patch) => {
    set({ interventions: get().interventions.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
    get().recompute();
  },
  requestMemo: () => set({ memoRequest: get().memoRequest + 1 }),

  applyAction: (action) => {
    const s = get();
    switch (action.tool) {
      case 'set_profile': s.setProfile(action.args.profile); break;
      case 'set_budget': s.setBudget(action.args.budget_eur); break;
      case 'set_weights': s.setWeights(action.args); break;
      case 'filter_zones': s.setFilters(action.args); break;
      case 'run_plan': s.recompute(); break;
      case 'select_zone': s.selectZone(action.args.zone_id); break;
      case 'write_memo': s.requestMemo(); break;
    }
  },
}));

export const plannerState = () => {
  const { profile, budget_eur, weights, filters, selected_zone_id, plan } = useStore.getState();
  return { profile, budget_eur, weights, filters, selected_zone_id, plan };
};

// react-dom/server renders from a store's server snapshot, and zustand 4 falls back to
// getInitialState when a store has none, so a server-rendered tree would always show the
// language the app started with. This app never renders on a server: the only such render
// is in the tests, where "server" means "right now". Subscribing by hand lets both
// snapshots read the live state, exactly as the browser does.
const readLang = () => useStore.getState().lang;

/** The words of the current language. Using it subscribes the component to a switch. */
export const useCopy = (): Copy =>
  copyFor(useSyncExternalStore(useStore.subscribe, readLang, readLang));
