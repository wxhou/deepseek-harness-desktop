import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { Wrench } from "lucide-react";
import SetupScreen, { InstallProgress, SetupStatus } from "./components/SetupScreen";
import SidebarPanel from "./components/SidebarPanel";
import { useI18n } from "./i18n/context";
import { generateTimestampedUrl } from "./hooks/useAutoSync";

const MAX_RETRIES = 8;

interface InstallerState {
  title: string;
  detail: string;
  percentage: number;
  logs: string[];
}

const initialInstaller: InstallerState = {
  title: "",
  detail: "",
  percentage: 0,
  logs: [],
};

const btnPrimary =
  "inline-flex cursor-pointer items-center justify-center rounded-md border border-accent bg-accent px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-accent2 disabled:cursor-not-allowed disabled:opacity-55";

export default function App() {
  const { t } = useI18n();
  const [status, setStatus] = useState<SetupStatus>("checking");
  const [installer, setInstaller] = useState<InstallerState>(initialInstaller);
  const [errorMsg, setErrorMsg] = useState("");
  const [serviceUrl, setServiceUrl] = useState("http://127.0.0.1:3080");
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeError, setIframeError] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const saved = localStorage.getItem("sidebarOpen");
    return saved === null ? false : saved === "true";
  });
  const [serviceRunning, setServiceRunning] = useState(false);

  const bootToken = useRef(0);
  const bootStartedRef = useRef(false);

  const iframeSrc = useMemo(() => generateTimestampedUrl(serviceUrl), [serviceUrl]);

  const handleToggleSidebar = () => {
    setSidebarOpen((prev) => {
      localStorage.setItem("sidebarOpen", String(!prev));
      return !prev;
    });
  };

  const refreshIframe = useCallback(() => {
    setIframeLoaded(false);
    setIframeError(false);
    setTimeout(() => setIframeKey((prev) => prev + 1), 800);
  }, []);

  const checkHealthViaProxy = async (): Promise<boolean> => {
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("health check timeout")), 8000);
      });
      const resultPromise = invoke<string>("proxy_health_check");
      const result = await Promise.race([resultPromise, timeoutPromise]);

      const lower = result.toLowerCase();
      if (
        lower.includes("healthy") ||
        lower.includes("ready") ||
        result.includes("200") ||
        result.includes("201") ||
        lower.includes("ok")
      ) {
        console.log("[App] health check passed:", result);
        return true;
      }
      console.log("[App] health check returned:", result);
      return false;
    } catch (err) {
      const message = String(err);
      if (message.includes("502") || message.includes("Bad Gateway")) {
        console.log("[App] transient 502 during health check, retrying");
      } else {
        console.log("[App] health check failed:", err);
      }
      return false;
    }
  };

  const boot = useCallback(async () => {
    const token = ++bootToken.current;
    let unlistenInstall: UnlistenFn | null = null;

    try {
      // Install-progress stream: only ever move the percentage forward, like
      // the reference installer store.
      unlistenInstall = await listen<InstallProgress>("install-progress", (e) => {
        const payload = e.payload;
        setInstaller((prev) => {
          if (payload.percentage < prev.percentage) {
            return prev;
          }
          const logs = payload.log
            ? [...prev.logs, payload.log].slice(-5)
            : prev.logs;
          return {
            title: payload.title || prev.title,
            detail: payload.detail || prev.detail,
            percentage: payload.percentage,
            logs,
          };
        });
      });

      const runtimeInfo = await invoke<{ service_url: string }>("get_runtime_info");
      setServiceUrl(runtimeInfo.service_url);

      // 已安装过则跳过安装界面，避免每次启动都闪现“正在安装依赖...”
      const config = await invoke<{ installed: boolean }>("get_app_config");

      // 1. Install dependencies (Node runtime + harness package).
      if (!config.installed) {
        setStatus("installing");
        setInstaller({ ...initialInstaller, title: t("status.installing") });
      }
      await invoke("install_dependencies");

      // 2. Launch + health check.
      setStatus("starting");
      setInstaller((prev) => ({ ...prev, title: t("status.starting") }));
      await invoke("launch_harness");
      setServiceRunning(true);

      let healthy = false;
      for (let attempt = 0; attempt < MAX_RETRIES && !healthy; attempt++) {
        healthy = await checkHealthViaProxy();
        if (!healthy) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
      if (!healthy) {
        throw new Error(
          t("errors.service_start_timeout", { port: new URL(serviceUrl).port || "3080" }),
        );
      }

      if (token !== bootToken.current) return;
      setStatus("ready");
      refreshIframe();
    } catch (err) {
      if (token !== bootToken.current) return;
      console.error("[App] startup failed:", err);
      setErrorMsg(String(err));
      setStatus("error");
      setServiceRunning(false);
    } finally {
      unlistenInstall?.();
    }
  }, [refreshIframe, serviceUrl, t]);

  // React StrictMode 在 dev 下会执行两次 effect，这里确保 boot 只挂载一次
  useEffect(() => {
    if (bootStartedRef.current) return;
    bootStartedRef.current = true;
    void boot();
  }, [boot]);

  // 进入 ready 后如果 iframe 长时间未加载（dsh 未就绪/挂起），
  // 转为错误界面，避免一直停在黑色加载遮罩
  useEffect(() => {
    if (status !== "ready" || iframeLoaded) return;
    const timer = setTimeout(() => {
      setIframeLoaded(false);
      setIframeError(true);
    }, 20000);
    return () => clearTimeout(timer);
  }, [status, iframeLoaded, iframeKey]);

  const restart = async () => {
    try {
      await invoke("shutdown_harness");
    } catch (err) {
      console.error("[App] shutdown during restart failed:", err);
    }
    setServiceRunning(false);
    setIframeLoaded(false);
    void boot();
  };

  const shutdown = async () => {
    try {
      await invoke("shutdown_harness");
    } catch (err) {
      console.error("[App] shutdown failed:", err);
    }
    setServiceRunning(false);
    setStatus("error");
    setErrorMsg(t("ui.stopped"));
  };

  const openBrowser = async () => {
    try {
      await invoke("open_in_browser");
    } catch (err) {
      console.error("[App] open in browser failed:", err);
    }
  };

  if (status === "error") {
    return (
      <div className="flex h-screen w-screen">
        <main className="relative flex-1 bg-canvas">
          <SetupScreen
            status="error"
            title=""
            detail=""
            percentage={installer.percentage}
            logs={installer.logs}
            errorMsg={serviceUrl ? `${errorMsg} (${serviceUrl})` : errorMsg}
            onRetry={boot}
          />
        </main>
        <button
          onClick={handleToggleSidebar}
          title={t("ui.settings")}
          className={`fixed top-4 z-40 flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-line bg-panel2 text-ink shadow-lg transition-all duration-200 hover:bg-[#26262d] ${
            sidebarOpen ? "right-[316px]" : "right-4"
          }`}
        >
          <Wrench className="h-[18px] w-[18px]" />
        </button>
        <SidebarPanel
          open={sidebarOpen}
          serviceRunning={serviceRunning}
          onRestart={restart}
          onShutdown={shutdown}
          onStart={boot}
          onOpenBrowser={openBrowser}
        />
      </div>
    );
  }

  if (status !== "ready") {
    return (
      <div className="flex h-screen w-screen">
        <main className="relative w-full bg-canvas">
          <SetupScreen
            status={status}
            title={installer.title}
            detail={installer.detail}
            percentage={installer.percentage}
            logs={installer.logs}
            errorMsg=""
            onRetry={boot}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen">
      <main className="relative flex-1 bg-canvas">
        {!iframeLoaded && (
          <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-3 bg-canvas text-ink">
            <span className="h-[34px] w-[34px] animate-spin rounded-full border-[3px] border-line border-t-accent" />
            <p>{t("status.loading")}</p>
          </div>
        )}
        {iframeError && (
          <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-3 bg-canvas text-ink">
            <p>{t("ui.iframe_error")}</p>
            <p className="text-muted">{t("ui.ensure_running", { url: serviceUrl })}</p>
            <button className={btnPrimary} onClick={refreshIframe}>
              {t("app.retry")}
            </button>
          </div>
        )}
        <iframe
          key={iframeKey}
          className="block h-full w-full border-none bg-white"
          src={iframeSrc}
          onLoad={() => {
            setIframeLoaded(true);
            setIframeError(false);
          }}
          onError={() => {
            setIframeError(true);
            setIframeLoaded(false);
          }}
          title={t("app.open_editor")}
        />
      </main>
      <button
        onClick={handleToggleSidebar}
        title={t("ui.settings")}
        className={`fixed top-4 z-40 flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-line bg-panel2 text-ink shadow-lg transition-all duration-200 hover:bg-[#26262d] ${
          sidebarOpen ? "right-[316px]" : "right-4"
        }`}
      >
        <Wrench className="h-[18px] w-[18px]" />
      </button>
      <SidebarPanel
        open={sidebarOpen}
        serviceRunning={serviceRunning}
        onRestart={restart}
        onShutdown={shutdown}
        onStart={boot}
        onOpenBrowser={openBrowser}
      />
    </div>
  );
}
