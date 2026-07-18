const APP_SW_PATHS = ["/sw.js"];

async function unregisterAppSW() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter((registration) =>
        APP_SW_PATHS.some(
          (path) => registration.active?.scriptURL.endsWith(path) || registration.installing?.scriptURL.endsWith(path),
        ),
      )
      .map((registration) => registration.unregister()),
  );
}

export async function registerPWA() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  const inIframe = window.self !== window.top;
  const swOff = new URL(window.location.href).searchParams.get("sw") === "off";
  if (!import.meta.env.PROD || inIframe || swOff) {
    await unregisterAppSW();
    return;
  }

  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (error) {
    console.error("SW register failed", error);
  }
}
