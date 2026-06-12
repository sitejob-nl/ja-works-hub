import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Smartphone, Monitor, Share, MoreVertical, PlusSquare } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const Installeren = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(isIOSDevice);

    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setIsInstalled(true);
    setDeferredPrompt(null);
  };

  if (isInstalled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <CardTitle className="text-2xl">✅ App geïnstalleerd</CardTitle>
            <CardDescription>SiteJob is al geïnstalleerd op dit apparaat.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col items-center justify-center gap-6">
      <div className="text-center mb-4">
        <img src="/pwa-192x192.png" alt="SiteJob" className="w-20 h-20 mx-auto mb-4 rounded-2xl shadow-lg" />
        <h1 className="text-3xl font-bold text-foreground">SiteJob installeren</h1>
        <p className="text-muted-foreground mt-2">Installeer de app op je telefoon of computer voor snelle toegang.</p>
      </div>

      {deferredPrompt && (
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Download className="h-5 w-5 text-stat-blue" /> Direct installeren
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button onClick={handleInstall} className="w-full" size="lg">
              <Download className="mr-2 h-4 w-4" /> App installeren
            </Button>
          </CardContent>
        </Card>
      )}

      {isIOS && (
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Smartphone className="h-5 w-5 text-stat-blue" /> iPhone / iPad
            </CardTitle>
            <CardDescription>Volg deze stappen in Safari:</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">1</div>
              <div>
                <p className="font-medium text-foreground">Tik op het deel-icoon</p>
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  Het <Share className="h-4 w-4 inline" /> icoon onderaan het scherm
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">2</div>
              <div>
                <p className="font-medium text-foreground">Scroll omlaag en tik op</p>
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <PlusSquare className="h-4 w-4 inline" /> "Zet op beginscherm"
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">3</div>
              <div>
                <p className="font-medium text-foreground">Bevestig met "Voeg toe"</p>
                <p className="text-sm text-muted-foreground">De app verschijnt op je beginscherm</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!isIOS && !deferredPrompt && (
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Monitor className="h-5 w-5 text-stat-blue" /> Android / Desktop
            </CardTitle>
            <CardDescription>Volg deze stappen in Chrome:</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">1</div>
              <div>
                <p className="font-medium text-foreground">Open het browsermenu</p>
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  Tik op <MoreVertical className="h-4 w-4 inline" /> rechtsboven
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">2</div>
              <div>
                <p className="font-medium text-foreground">Kies "App installeren"</p>
                <p className="text-sm text-muted-foreground">Of "Toevoegen aan startscherm"</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">3</div>
              <div>
                <p className="font-medium text-foreground">Bevestig de installatie</p>
                <p className="text-sm text-muted-foreground">De app verschijnt als los icoon</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Installeren;
