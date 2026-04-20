import {
  BrushCleaning,
  ChevronRight,
  Coins,
  Palette,
  Power,
  Sparkles,
  Star,
} from "lucide-react";
import { M_PLUS_Rounded_1c, Noto_Sans_JP } from "next/font/google";

import styles from "./menu-screen.module.css";

const displayFont = M_PLUS_Rounded_1c({
  weight: ["700", "800"],
  subsets: ["latin"],
  variable: "--font-menu-display",
});

const bodyFont = Noto_Sans_JP({
  weight: ["500", "700"],
  subsets: ["latin"],
  variable: "--font-menu-body",
});

const menuItems = [
  "クイック対戦",
  "プライベートルーム",
  "招待コード",
  "ショップ",
  "遊び方",
  "プレイ履歴",
  "設定",
] as const;

const profileRows = [
  {
    label: "アバター",
    value: "Neon Fox",
    icon: Sparkles,
  },
  {
    label: "スタイル",
    value: "Dream Ink",
    icon: Palette,
  },
] as const;

export function MenuScreen() {
  return (
    <main className={`${displayFont.variable} ${bodyFont.variable} ${styles.pageShell}`}>
      <section className={styles.scene}>
        <div className={styles.backgroundGlow} />
        <div className={styles.spotlight} />
        <div className={styles.gridTexture} />
        <div className={styles.surfaceSheen} />

        <header className={styles.hud}>
          <div className={styles.playerPill}>
            <span className={styles.pillTag}>LV.12</span>
            <span className={styles.pillDivider} />
            <span className={styles.playerName}>YAJIMA</span>
            <span className={styles.pillDivider} />
            <span className={styles.playerScore}>SKILL 1840</span>
          </div>

          <div className={styles.currencyPill}>
            <Coins size={18} strokeWidth={2.4} />
            <span>INK 2450</span>
          </div>
        </header>

        <div className={styles.watermarkWrap} aria-hidden="true">
          <p className={styles.watermark} data-testid="menu-watermark">
            PROMPDOJO
          </p>
          <p className={styles.watermarkSubline}>PROMPT MIRROR ARENA</p>
        </div>

        <div className={styles.layout}>
          <section className={styles.profileZone} data-testid="profile-area">
            <div className={styles.profileIntro}>
              <span className={styles.profileBadge}>HOME MENU</span>
              <h1 className={styles.screenTitle}>ネオンの舞台へようこそ</h1>
              <p className={styles.screenLead}>
                推理と生成がぶつかり合う、配信映えするプロンプト対戦ロビー。
              </p>
            </div>

            <div className={styles.easelFrame}>
              <div className={styles.easelTopBeam} />
              <div className={styles.easelCanvas}>
                <div className={styles.canvasClip} />
                <div className={styles.canvasHeader}>
                  <span className={styles.canvasTag}>PROMPDOJO PROFILE</span>
                  <Star size={15} strokeWidth={2.2} />
                </div>

                <div className={styles.avatarMedallion}>
                  <div className={styles.avatarCore}>
                    <span className={styles.avatarFace}>🦊</span>
                  </div>
                  <div className={styles.avatarRing} />
                </div>

                <div className={styles.profileCopy}>
                  <p className={styles.profileLabel}>Featured Player</p>
                  <p className={styles.profileValue}>Neon Fox Crafter</p>
                  <p className={styles.profileNote}>
                    ひらめきと再現力でステージを支配する、今夜のメインアーティスト。
                  </p>
                </div>

                <div className={styles.profileSelectors}>
                  {profileRows.map(({ label, value, icon: Icon }) => (
                    <button
                      key={label}
                      type="button"
                      className={styles.selectorRow}
                      aria-label={`${label}: ${value}`}
                    >
                      <span className={styles.selectorMeta}>
                        <span className={styles.selectorIcon}>
                          <Icon size={16} strokeWidth={2.2} />
                        </span>
                        <span>
                          <span className={styles.selectorLabel}>{label}</span>
                          <span className={styles.selectorValue}>{value}</span>
                        </span>
                      </span>
                      <ChevronRight size={18} strokeWidth={2.5} />
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.easelShelf} />
              <div className={`${styles.easelLeg} ${styles.easelLegLeft}`} />
              <div className={`${styles.easelLeg} ${styles.easelLegRight}`} />
            </div>
          </section>

          <div className={styles.centerLane} aria-hidden="true">
            <div className={styles.centerBadge}>STAGE READY</div>
            <div className={styles.centerSpark}>
              <BrushCleaning size={30} strokeWidth={2.4} />
            </div>
          </div>

          <nav className={styles.menuZone} aria-label="メインメニュー">
            <div className={styles.menuFrame}>
              {menuItems.map((item) => {
                const isPrimary = item === "プライベートルーム";

                return (
                  <button
                    key={item}
                    type="button"
                    className={styles.menuButton}
                    data-primary={isPrimary}
                  >
                    <span className={styles.menuButtonGlow} aria-hidden="true" />
                    <span className={styles.menuButtonLabel}>{item}</span>
                    <span className={styles.menuButtonArrow}>
                      <ChevronRight size={24} strokeWidth={2.8} />
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>
        </div>

        <button type="button" className={styles.exitButton}>
          <Power size={18} strokeWidth={2.4} />
          <span>ゲームを終了</span>
        </button>

        <div className={styles.rotateOverlay} data-testid="orientation-overlay">
          <div className={styles.rotateCard}>
            <p className={styles.rotateEyebrow}>LANDSCAPE ONLY</p>
            <h2 className={styles.rotateTitle}>横向きでご覧ください</h2>
            <p className={styles.rotateMessage}>
              このメニュー画面モックはランドスケープ表示に最適化されています。
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
