import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  ChevronRight,
  Coins,
  Flag,
  History,
  Palette,
  Power,
  Settings2,
  ShoppingBag,
  Sparkles,
  Star,
  Ticket,
  Trophy,
  Users,
} from "lucide-react";
import { Fredoka, M_PLUS_Rounded_1c, Noto_Sans_JP } from "next/font/google";

import styles from "./menu-yellow-screen.module.css";

const displayFont = M_PLUS_Rounded_1c({
  weight: ["700", "800"],
  subsets: ["latin"],
  variable: "--font-menu-yellow-display",
});

const accentFont = Fredoka({
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-menu-yellow-accent",
});

const bodyFont = Noto_Sans_JP({
  weight: ["500", "700"],
  subsets: ["latin"],
  variable: "--font-menu-yellow-body",
});

const menuItems: Array<{
  label: string;
  variant: "primary" | "secondary" | "utility";
  icon: LucideIcon;
}> = [
  { label: "レートマッチ", variant: "primary", icon: Trophy },
  { label: "プライベートマッチ", variant: "secondary", icon: Users },
  { label: "招待コード", variant: "secondary", icon: Ticket },
  { label: "ショップ", variant: "utility", icon: ShoppingBag },
  { label: "遊び方", variant: "secondary", icon: BookOpen },
  { label: "プレイ履歴", variant: "secondary", icon: History },
  { label: "設定", variant: "secondary", icon: Settings2 },
] as const;

const stickers = [
  { label: "Lv.12", tone: "yellow" },
  { label: "Rank S", tone: "sky" },
  { label: "Party Ready", tone: "mint" },
] as const;

const profileRows = [
  { label: "アバター", value: "Neon Fox", icon: Sparkles },
  { label: "スタイル", value: "Dream Ink", icon: Palette },
] as const;

export function MenuYellowScreen() {
  return (
    <main
      className={`${displayFont.variable} ${accentFont.variable} ${bodyFont.variable} ${styles.pageShell}`}
    >
      <section className={styles.scene}>
        <div className={styles.stageGlow} />
        <div className={styles.spotlights} />
        <div className={styles.checkerPattern} />
        <div className={styles.confettiLayer} />

        <header className={styles.hud}>
          <div className={styles.playerRibbon}>
            <span className={styles.ribbonTag}>PARTY LOBBY</span>
            <span className={styles.ribbonDivider} />
            <span className={styles.ribbonValue}>YAJIMA</span>
          </div>

          <div className={styles.coinPill} data-testid="yellow-coin-pill">
            <Coins size={20} strokeWidth={2.4} />
            <span>INK 2450</span>
          </div>
        </header>

        <div className={styles.layout}>
          <section
            className={styles.profileZone}
            data-testid="yellow-profile-area"
          >
            <div className={styles.profileIntro}>
              <span className={styles.profileChip}>PROMPDOJO PARTY</span>
              <h1 className={styles.screenTitle}>ステージを熱くする、もうひとつの入口</h1>
              <p className={styles.screenLead}>
                クリーム色のカードと黄色の主役ボタンで、PrompDojo を
                パーティアリーナ風に再解釈したメニュー案です。
              </p>
            </div>

            <div className={styles.standFrame}>
              <div className={styles.standBar} />
              <div className={styles.profileCard}>
                <div className={styles.ribbonHeader}>
                  <span className={styles.ribbonHeaderLabel}>PROMPDOJO PARTY</span>
                  <Flag size={16} strokeWidth={2.4} />
                </div>

                <div className={styles.avatarSection}>
                  <div className={styles.avatarHalo} />
                  <div className={styles.avatarCard}>
                    <div className={styles.avatarCore}>
                      <span className={styles.avatarFace}>🦊</span>
                    </div>
                  </div>

                  <div className={styles.stickerRail}>
                    {stickers.map((sticker) => (
                      <span
                        key={sticker.label}
                        className={styles.sticker}
                        data-tone={sticker.tone}
                      >
                        {sticker.label}
                      </span>
                    ))}
                  </div>
                </div>

                <div className={styles.cardCopy}>
                  <p className={styles.cardEyebrow}>Featured Collection Card</p>
                  <p className={styles.cardTitle}>Neon Fox Crafter</p>
                  <p className={styles.cardNote}>
                    パーティの中心でひらめきをつなぐ、今夜のスターアーティスト。
                  </p>
                </div>

                <div className={styles.selectorList}>
                  {profileRows.map(({ label, value, icon: Icon }) => (
                    <button
                      key={label}
                      type="button"
                      className={styles.selectorRow}
                      aria-label={`${label}: ${value}`}
                    >
                      <span className={styles.selectorMeta}>
                        <span className={styles.selectorIcon}>
                          <Icon size={16} strokeWidth={2.3} />
                        </span>
                        <span>
                          <span className={styles.selectorLabel}>{label}</span>
                          <span className={styles.selectorValue}>{value}</span>
                        </span>
                      </span>
                      <ChevronRight size={18} strokeWidth={2.6} />
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.standShelf} />
              <div className={`${styles.standLeg} ${styles.standLegLeft}`} />
              <div className={`${styles.standLeg} ${styles.standLegRight}`} />
            </div>
          </section>

          <section className={styles.centerZone}>
            <div className={styles.bannerCard} data-testid="yellow-center-banner">
              <div className={styles.bannerTop}>
                <span className={styles.bannerChip}>EVENT BANNER</span>
                <span className={styles.bannerChipSecondary}>WEEKEND HYPE</span>
              </div>
              <h2 className={styles.bannerTitle}>Party Arena Open</h2>
              <p className={styles.bannerText}>
                星、チケット、リボンを散らした軽い祝祭感で、中央は抽象パターンだけに留めます。
              </p>
              <div className={styles.bannerBadges}>
                <span className={styles.bannerBadge}>
                  <Star size={14} strokeWidth={2.4} />
                  HYPE 84%
                </span>
                <span className={styles.bannerBadge}>
                  <Ticket size={14} strokeWidth={2.4} />
                  7 EVENTS
                </span>
              </div>
            </div>

            <div className={styles.abstractStage} aria-hidden="true">
              <div className={styles.stageCircle} />
              <div className={styles.stageTicket} />
              <div className={styles.stageStarLarge}>
                <Star size={48} strokeWidth={2.2} />
              </div>
              <div className={styles.stageStarSmall}>
                <Sparkles size={26} strokeWidth={2.3} />
              </div>
            </div>
          </section>

          <nav className={styles.menuZone} aria-label="黄色メニュー">
            <div className={styles.menuStack}>
              {menuItems.map(({ label, variant, icon: Icon }) => (
                <button
                  key={label}
                  type="button"
                  className={styles.menuButton}
                  data-variant={variant}
                >
                  <span className={styles.buttonGloss} aria-hidden="true" />
                  <span className={styles.buttonLead}>
                    <span className={styles.buttonIcon}>
                      <Icon size={22} strokeWidth={2.5} />
                    </span>
                    <span className={styles.buttonLabel}>{label}</span>
                  </span>
                  <span className={styles.buttonArrow}>
                    <ChevronRight size={24} strokeWidth={2.8} />
                  </span>
                </button>
              ))}
            </div>
          </nav>
        </div>

        <button type="button" className={styles.exitButton}>
          <Power size={18} strokeWidth={2.4} />
          <span>ゲームを終了</span>
        </button>

        <div
          className={styles.rotateOverlay}
          data-testid="yellow-orientation-overlay"
        >
          <div className={styles.rotateCard}>
            <p className={styles.rotateEyebrow}>LANDSCAPE FIRST</p>
            <h2 className={styles.rotateTitle}>横向きでご覧ください</h2>
            <p className={styles.rotateMessage}>
              この黄色系メニューモックは、横向きのステージ構成で最も見やすくなります。
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
