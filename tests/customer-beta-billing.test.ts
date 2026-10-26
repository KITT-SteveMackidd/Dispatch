import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';

type ModuleMocks = Record<string, unknown>;

function loadSource(relative: string, mocks: ModuleMocks) {
  const filename = join(process.cwd(), relative);
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} as Record<string, any> };
  new Function('require', 'module', 'exports', '__DEV__', code)((name: string) => {
    if (name === 'react/jsx-runtime') return jsxRuntime;
    if (name === '@/config/beta-mode') return { isExistingDispatchCustomerBeta: () => false, ...(mocks[name] as object) };
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error(`Unexpected runtime import ${name}`);
  }, module, module.exports, false);
  return module.exports;
}

function billingHarness(customerBeta: boolean, existingBackend = false) {
  const invoke = vi.fn().mockResolvedValue({ data: { removed: true } });
  const httpsCallable = vi.fn(() => invoke);
  const onSnapshot = vi.fn(() => () => {});
  const doc = vi.fn();
  const service = loadSource('services/billing.ts', {
    '@/config/beta-mode': { isCustomerBeta: () => customerBeta, isExistingDispatchCustomerBeta: () => existingBackend },
    '@/lib/firebase': { db: {}, functions: {}, firebaseEmulatorConfiguration: { enabled: false } },
    '@/lib/subscriptions': { defaultOrganizationBilling: () => ({}) },
    'firebase/functions': { httpsCallable },
    'firebase/firestore': { doc, onSnapshot },
  });
  return { service, httpsCallable, invoke, onSnapshot, doc };
}

function revenueCatHarness(customerBeta: boolean) {
  const sdk = Object.fromEntries([
    'setLogLevel', 'isConfigured', 'configure', 'getAppUserID', 'logIn', 'getCustomerInfo',
    'logOut', 'getOfferings', 'purchasePackage', 'restorePurchases',
  ].map(name => [name, vi.fn()]));
  sdk.isConfigured.mockResolvedValue(false);
  sdk.getCustomerInfo.mockResolvedValue({ managementURL: 'https://example.test/manage' });
  sdk.restorePurchases.mockResolvedValue({});
  const openURL = vi.fn();
  const service = loadSource('services/revenuecat.ts', {
    '@/config/beta-mode': { isCustomerBeta: () => customerBeta },
    'expo-constants': { __esModule: true, default: { executionEnvironment: 'standalone' }, ExecutionEnvironment: { StoreClient: 'storeClient' } },
    'react-native': { Platform: { OS: 'android' }, Linking: { openURL } },
    'react-native-purchases': { __esModule: true, default: sdk, LOG_LEVEL: { INFO: 1, DEBUG: 2 } },
    '@/lib/firebase': { firebaseEmulatorConfiguration: { enabled: false } },
    '@/lib/revenuecat-config': { selectRevenueCatConfiguration: () => ({ configured: true, runtime: 'android', apiKey: 'goog_test', preview: false }) },
    '@/lib/subscriptions': { SUBSCRIPTION_PLANS: [] },
  });
  return { service, sdk, openURL };
}

function tabsHarness(customerBeta: boolean, organizationId: string | null = 'org-a') {
  const effects: Array<() => (() => void) | undefined> = [];
  const stateUpdates: Array<ReturnType<typeof vi.fn>> = [];
  let finishInitialization: (value: { accessMode: string }) => void = () => {};
  const initialization = new Promise<{ accessMode: string }>(resolve => { finishInitialization = resolve; });
  const initializeOrganizationBilling = vi.fn(() => initialization);
  let notifyBilling: (value: { accessMode: string }) => void = () => {};
  let failBilling: () => void = () => {};
  const unsubscribe = vi.fn();
  const watchOrganizationBilling = vi.fn((_org, change, failure) => {
    notifyBilling = change;
    failBilling = failure;
    return unsubscribe;
  });
  const screen = loadSource('app/(tabs)/_layout.tsx', {
    '@/config/beta-mode': { isCustomerBeta: () => customerBeta },
    '@expo/vector-icons': { Feather: 'Icon', FontAwesome5: 'Icon', MaterialCommunityIcons: 'Icon' },
    'expo-router': { Tabs: { Screen: 'TabScreen' }, useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) },
    react: {
      useEffect: (effect: () => (() => void) | undefined) => { effects.push(effect); },
      useMemo: (factory: () => unknown) => factory(),
      useRef: (value: unknown) => ({ current: value }),
      useState: (value: unknown) => { const setter = vi.fn(); stateUpdates.push(setter); return [stateUpdates.length === 3 ? true : value, setter]; },
    },
    'react-native': { Pressable: 'Pressable', Text: 'Text', Alert: { alert: vi.fn() } },
    'react-native-gesture-handler': { GestureHandlerRootView: 'GestureRoot' },
    '@/context/session': { useSession: () => ({ profile: { uid: 'manager', role: 'manager', organizationId }, signOut: vi.fn() }) },
    '@/context/theme': { useThemeMode: () => ({ resolvedThemeMode: 'light' }) },
    '@/services/dispatch': { watchUserTeamUnreadCounts: () => () => {}, watchUserUnreadNotificationCount: () => () => {} },
    '@/services/billing': { initializeOrganizationBilling, watchOrganizationBilling },
  });
  const tree = screen.default();
  return {
    tree, effects, initializeOrganizationBilling, watchOrganizationBilling, unsubscribe,
    accessUpdates: stateUpdates[2], finishInitialization,
    notifyBilling: (mode: string) => notifyBilling({ accessMode: mode }),
    failBilling: () => failBilling(),
  };
}

function elements(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object' || !tree.props) return [];
  return [tree, ...Object.values(tree.props).flatMap(elements)];
}

function teamsHarness(customerBeta: boolean, existingBackend = false) {
  const effects: Array<() => (() => void) | undefined> = [];
  const stateUpdates: Array<ReturnType<typeof vi.fn>> = [];
  const watchBilling = vi.fn(() => () => {});
  const transfer = vi.fn();
  const organization = { id: 'org', name: 'Beta crew', managerIds: ['manager', 'other'], workerIds: [], billingManagerId: 'manager' };
  const members = [{ uid: 'manager', displayName: 'Manager', role: 'manager' }, { uid: 'other', displayName: 'Other Manager', role: 'manager' }];
  const screen = loadSource('app/(tabs)/teams.tsx', {
    '@/config/beta-mode': { isCustomerBeta: () => customerBeta, isExistingDispatchCustomerBeta: () => existingBackend },
    react: {
      useEffect: (effect: () => (() => void) | undefined) => { effects.push(effect); },
      useMemo: (factory: () => unknown) => factory(),
      useState: (value: any) => {
        const index = stateUpdates.length;
        const setter = vi.fn(); stateUpdates.push(setter);
        const overrides: Record<number, unknown> = { 1: organization, 2: members, 8: true, 9: 'other', 17: 'invite-manager' };
        return [index in overrides ? overrides[index] : typeof value === 'function' ? value() : value, setter];
      },
    },
    'react-native': { Alert: { alert: vi.fn() }, FlatList: 'FlatList', Image: 'Image', Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (value: unknown) => value } },
    '@expo/vector-icons': { MaterialIcons: 'Icon' },
    'expo-router': { useRouter: () => ({ push: vi.fn(), navigate: vi.fn() }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@/context/session': { useSession: () => ({ profile: { uid: 'manager', role: 'manager', organizationId: 'org' } }) },
    '@/context/theme': { useThemeMode: () => ({ resolvedThemeMode: 'light' }) },
    '@/constants/branding': { headerLogoSource: {} },
    '@/constants/accessibility': { ACCESSIBLE_TEXT_MAX_MULTIPLIER: 2, MINIMUM_TOUCH_TARGET: 44 },
    '@/services/dispatch': {
      buildOrganizationChatThreadId: (id: string) => id, buildOrganizationManagersThreadId: (id: string) => id,
      watchManagerTeams: () => () => {}, watchIncomingChatThreadHeads: () => () => {}, watchUserTeamUnreadCounts: () => () => {},
      loadOrganizationMembers: async () => ({ organization, members }), ensureOrganizationCommunicationThreads: async () => {},
    },
    '@/lib/worker-invite-validation': {}, '@/lib/secure-invites': {}, '@/lib/invite-billing-alert': {}, '@/lib/billing-manager': {},
    '@/services/billing': { watchOrganizationBilling: watchBilling, transferOrganizationBillingManager: transfer },
    '@/lib/subscriptions': { defaultOrganizationBilling: () => ({}), isLivePaidSubscription: () => false, getOrganizationSeatUsage: () => ({ acceptedSeats: 2, reservedSeats: 0, memberCap: 5, remainingSeats: 3 }), getSubscriptionPlan: () => ({ name: 'Free' }) },
    '@/lib/chat-list-membership': { buildCurrentManagerIds: () => ['manager'], getVisibleManagerChatWorkerIds: () => [] },
    '@/components/KeyboardAwareDrawer': { KeyboardAwareDrawer: 'Drawer', KeyboardAwareDrawerScrollView: 'DrawerScroll', KeyboardAwareDrawerTextInput: 'TextInput' },
  });
  return { tree: screen.default(), effects, stateUpdates, watchBilling, transfer };
}

describe('complimentary customer beta billing boundary', () => {
  it('refuses billing lifecycle calls and subscriptions without contacting Firebase', async () => {
    const { service, httpsCallable, onSnapshot, doc } = billingHarness(true);
    for (const action of [
      () => service.initializeOrganizationBilling(),
      () => service.transferOrganizationBillingManager('manager-2'),
      () => service.prepareOrganizationSubscriptionChange({ planId: 'crew', billingPeriod: 'monthly', purchaseStore: 'play_store' }),
      () => service.refreshOrganizationSubscription('play_store'),
      () => service.prepareOrganizationSubscriptionRestore('play_store'),
    ]) await expect(action()).rejects.toThrow('complimentary customer beta');
    const onChange = vi.fn();
    expect(() => service.watchOrganizationBilling('org', onChange)).toThrow('complimentary customer beta');
    expect(httpsCallable).not.toHaveBeenCalled();
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(doc).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps ordinary membership actions on the existing authenticated callable', async () => {
    const { service, httpsCallable, invoke } = billingHarness(true);
    await expect(service.removeOrganizationMember('worker')).resolves.toEqual({ removed: true });
    expect(httpsCallable).toHaveBeenCalledWith({}, 'removeOrganizationMember');
    expect(invoke).toHaveBeenCalledWith({ targetUserId: 'worker' });
  });

  it('refuses member removal on the existing Dispatch beta backend before contacting its missing endpoint', async () => {
    const { service, httpsCallable, invoke } = billingHarness(true, true);
    await expect(service.removeOrganizationMember('worker')).rejects.toThrow('not available in this beta build');
    expect(httpsCallable).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not configure or contact RevenueCat even if native keys exist', async () => {
    const { service, sdk, openURL } = revenueCatHarness(true);
    expect(service.getRevenueCatPurchaseStore()).toBeNull();
    expect(service.getRevenueCatConfiguration()).toMatchObject({ configured: false, reason: 'customer_beta_disabled' });
    expect(await service.identifyRevenueCatUser('manager')).toMatchObject({ configured: false, customerInfo: null });
    expect(await service.loadDispatchRevenueCatOffering('manager')).toMatchObject({ offering: null, packages: [] });
    await expect(service.purchaseDispatchRevenueCatPackage({ firebaseUid: 'manager', billingManagerId: 'manager', packageIdentifier: 'crew', changeTiming: 'immediate' })).rejects.toThrow('complimentary customer beta');
    await expect(service.restoreDispatchPurchases({ firebaseUid: 'manager', billingManagerId: 'manager' })).rejects.toThrow('complimentary customer beta');
    await expect(service.openDispatchSubscriptionManagement('https://billing.revenuecat.com/manage')).rejects.toThrow('complimentary customer beta');
    await expect(service.logOutDispatchRevenueCatUser('manager')).resolves.toBe(false);
    for (const call of Object.values(sdk)) expect(call).not.toHaveBeenCalled();
    expect(openURL).not.toHaveBeenCalled();
  });

  it('retains billing initialization and SDK behavior outside customer beta', async () => {
    const billing = billingHarness(false);
    await billing.service.initializeOrganizationBilling();
    expect(billing.httpsCallable).toHaveBeenCalledWith({}, 'initializeOrganizationBilling');
    const native = revenueCatHarness(false);
    await native.service.restoreDispatchPurchases({ firebaseUid: 'manager', billingManagerId: 'manager' });
    expect(native.service.getRevenueCatPurchaseStore()).toBe('play_store');
    expect(native.sdk.configure).toHaveBeenCalledWith({ apiKey: 'goog_test', appUserID: 'manager' });
    expect(native.sdk.restorePurchases).toHaveBeenCalledOnce();
  });

  it('customer tabs clear stale read-only state without billing initialization, listeners or banner', () => {
    const tabs = tabsHarness(true);
    tabs.effects.forEach(effect => effect());
    expect(tabs.accessUpdates).toHaveBeenCalledWith(false);
    expect(tabs.initializeOrganizationBilling).not.toHaveBeenCalled();
    expect(tabs.watchOrganizationBilling).not.toHaveBeenCalled();
    expect(JSON.stringify(tabs.tree)).not.toContain('Organization is read-only');
  });

  it('opening customer Teams makes no billing calls or exposes stale capacity/transfer controls', async () => {
    const teams = teamsHarness(true);
    const cleanups = teams.effects.map(effect => effect());
    await Promise.resolve();
    expect(teams.watchBilling).not.toHaveBeenCalled();
    expect(teams.transfer).not.toHaveBeenCalled();
    expect(teams.stateUpdates[8]).toHaveBeenCalledWith(false);
    expect(JSON.stringify(teams.tree)).not.toContain('Billing Manager');
    expect(JSON.stringify(teams.tree)).not.toContain('member seats');
    cleanups.forEach(cleanup => cleanup?.());
    const qa = teamsHarness(false);
    qa.effects[2]();
    expect(qa.watchBilling).toHaveBeenCalledOnce();
    expect(JSON.stringify(qa.tree)).toContain('Pass Billing Manager role');
  });

  it('existing-backend Teams keeps email invitations without billing controls or share-only instructions', () => {
    const teams = teamsHarness(true, true);
    teams.effects[2]();
    expect(teams.watchBilling).not.toHaveBeenCalled();
    expect(JSON.stringify(teams.tree)).toContain('This address only receives the invitation');
    expect(JSON.stringify(teams.tree)).not.toContain('beta invitation emails are not sent');
    expect(JSON.stringify(teams.tree)).not.toContain('Billing Manager');
  });

  it('customer Managers can remove another Manager without a billing-role transfer', async () => {
    const organization = { id: 'org', name: 'Beta crew', managerIds: ['manager', 'owner'], workerIds: [], billingManagerId: 'owner' };
    const roster = { organization, members: [
      { uid: 'manager', displayName: 'Current Manager', role: 'manager' },
      { uid: 'owner', displayName: 'Previous Owner', role: 'manager' },
    ] };
    let stateIndex = 0;
    const loadMembers = vi.fn().mockResolvedValue(roster);
    const removeMember = vi.fn().mockResolvedValue({ removed: true });
    const transfer = vi.fn();
    const alert = vi.fn();
    const viewer = { uid: 'manager', role: 'manager', organizationId: 'org' };
    const screen = loadSource('app/billing.tsx', {
      '@/config/beta-mode': { isCustomerBeta: () => true },
      '@expo/vector-icons': { MaterialIcons: 'Icon' }, 'expo-router': { Stack: { Screen: 'StackScreen' } },
      react: { useEffect: vi.fn(), useRef: (value: unknown) => ({ current: value }), useState: (value: unknown) => [stateIndex++ === 0 ? roster : value === true ? false : value, vi.fn()] },
      'react-native': { ScrollView: 'ScrollView', View: 'View', Text: 'Text', Pressable: 'Pressable', Alert: { alert }, StyleSheet: { create: (value: unknown) => value } },
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
      '@/context/session': { useSession: () => ({ profile: viewer }) },
      '@/context/theme': { useThemeMode: () => ({ resolvedThemeMode: 'light' }) },
      '@/lib/firebase': {}, '@/services/billing': { removeOrganizationMember: removeMember, transferOrganizationBillingManager: transfer, billingErrorMessage: String },
      '@/lib/secure-invites': {}, '@/services/dispatch': { loadOrganizationMembers: loadMembers }, '@/services/revenuecat': {}, '@/lib/subscriptions': {},
    });
    const branch = screen.default();
    const notice = branch.type(branch.props);
    const rosterElement = elements(notice).find(element => element.type?.name === 'CustomerBetaMemberManagement');
    const management = rosterElement.type(rosterElement.props);
    const buttons = elements(management).filter(element => element.type === 'Pressable');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.accessibilityLabel).toBe('Remove Previous Owner');
    buttons[0].props.onPress();
    expect(removeMember).not.toHaveBeenCalled();
    const confirmation = alert.mock.calls[0][2].find((action: { text: string }) => action.text === 'Remove member');
    confirmation.onPress();
    await vi.waitFor(() => expect(loadMembers).toHaveBeenCalledWith('org'));
    expect(removeMember).toHaveBeenCalledWith('owner');
    expect(transfer).not.toHaveBeenCalled();
    roster.members.splice(1);
    roster.organization.managerIds.splice(1);
    stateIndex = 0;
    expect(elements(rosterElement.type(rosterElement.props)).filter(element => element.type === 'Pressable')).toHaveLength(0);
    viewer.role = 'worker';
    stateIndex = 0;
    expect(rosterElement.type(rosterElement.props)).toBeNull();
    expect(removeMember).toHaveBeenCalledTimes(1);
  });

  it('an organization switch ignores old billing callbacks and missing membership clears the banner', async () => {
    const tabs = tabsHarness(false);
    const stop = tabs.effects[3]();
    expect(tabs.accessUpdates).toHaveBeenCalledWith(false);
    expect(tabs.watchOrganizationBilling).toHaveBeenCalledWith('org-a', expect.any(Function), expect.any(Function));
    stop?.();
    tabs.accessUpdates.mockClear();
    tabs.notifyBilling('read_only');
    tabs.failBilling();
    tabs.finishInitialization({ accessMode: 'read_only' });
    await Promise.resolve();
    expect(tabs.accessUpdates).not.toHaveBeenCalled();
    expect(tabs.unsubscribe).toHaveBeenCalledOnce();
    const noOrganization = tabsHarness(false, null);
    noOrganization.effects[3]();
    expect(noOrganization.accessUpdates).toHaveBeenCalledWith(false);
    expect(noOrganization.initializeOrganizationBilling).not.toHaveBeenCalled();
  });

  it.each([false, true])('direct billing navigation renders only the complimentary notice without loading billing hooks (existing backend: %s)', (existingBackend) => {
    const forbidden = vi.fn(() => { throw new Error('Billing work must not mount'); });
    const screen = loadSource('app/billing.tsx', {
      '@/config/beta-mode': { isCustomerBeta: () => true, isExistingDispatchCustomerBeta: () => existingBackend },
      '@expo/vector-icons': { MaterialIcons: 'Icon' },
      'expo-router': { Stack: { Screen: 'StackScreen' }, useRouter: forbidden },
      react: { useEffect: forbidden, useMemo: forbidden, useState: forbidden },
      'react-native': { ScrollView: 'ScrollView', View: 'View', Text: 'Text', StyleSheet: { create: (value: unknown) => value } },
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
      '@/context/session': { useSession: forbidden },
      '@/context/theme': { useThemeMode: () => ({ resolvedThemeMode: 'light' }) },
      '@/lib/firebase': {}, '@/services/billing': {}, '@/lib/secure-invites': {},
      '@/services/dispatch': {}, '@/services/revenuecat': {}, '@/lib/subscriptions': {},
    });
    const branch = screen.default();
    const notice = branch.type(branch.props);
    expect(JSON.stringify(notice)).toContain('Complimentary customer beta');
    expect(JSON.stringify(notice)).not.toContain('Choose your plan');
    const memberRoster = elements(notice).find(element => element.type?.name === 'CustomerBetaMemberManagement');
    if (existingBackend) {
      expect(memberRoster).toBeUndefined();
      expect(JSON.stringify(notice)).toContain('Managers can email invitation links');
      expect(JSON.stringify(notice)).not.toContain('Invitation emails and email reminders are unavailable');
    } else {
      expect(memberRoster).toBeDefined();
    }
    expect(forbidden).not.toHaveBeenCalled();
  });
});
