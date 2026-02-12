# EYES ON THE STREET — Product & Monetization Plan

## Vision

Urban intelligence platform for New Yorkers. Real-time subway safety powered by open data — empowering people with the surveillance information that used to be locked behind institutional walls. Crime data, crowd density, service disruptions, weather, and temporal patterns fused into one actionable view.

**Not a fear app.** Citizen makes people anxious. We make people informed.

---

## Competitive Position

### The gap nobody fills

Transit apps (MTA, Citymapper, Transit) have zero safety data. Safety apps (Citizen, Noonlight, SpotCrime) have zero transit intelligence. Nobody combines them.

| | Eyes on the Street | Citizen | MTA App | Safe Subway |
|-|:--:|:--:|:--:|:--:|
| Station-level safety scores | Y | - | - | Partial |
| Real-time crowd estimation | Y | - | Partial | - |
| Time-of-day risk context | Y | - | - | - |
| Crime + transit data fusion | Y | - | - | - |
| Service alert → safety impact | Y | - | Y | - |
| Weather-modulated risk | Y | - | - | - |
| Safest hour recommendations | Y | - | - | - |
| Safer alternative stations | Y | - | - | - |
| Free, no paywalled alerts | Y | Partial | Y | Y |

**Citizen**: 491K ratings, $35M revenue, $180M raised — but users hate the paywalling, fear-mongering, and racism in comments. NYC partnered with them anyway (July 2025) because nobody else exists.

**Safe Subway**: 0 ratings. Dead. Built by an accounting firm.

**We have no real competition in this niche.**

---

## Monetization Model

### Core Principle

**Never paywall safety-critical information.** Real-time station safety levels, alerts, and crowd data stay free forever. This is non-negotiable — both ethically and strategically. Citizen's biggest reputational wound is paywalling alerts. Consumer Reports has explicitly called out safety paywalls. We don't repeat that mistake.

### Revenue Tiers (in order of priority)

#### Tier 1: Freemium Consumer Subscription — "Street Intelligence Pro"

**$4.99/month or $39.99/year**

Target: 2-3% conversion of active users (industry benchmark for safety apps).

| Free (everyone) | Pro (paid) |
|-----------------|------------|
| Real-time station safety levels | Historical safety analytics (trends, patterns) |
| Live crowd estimation | Personal route safety planner |
| Service alert impact | Custom geofence alerts (home, work, school) |
| Weather impact display | "Safest commute" time recommendations |
| Top 3 safest hours per station | Full 24h hourly breakdown per station |
| 3 nearest safe alternatives | Family/group location sharing (up to 5) |
| Explore mode (current day) | Explore mode (any day of week) |
| Basic safety stats | Downloadable safety reports |
| | Ad-free experience |
| | Weekly intelligence digest (email/push) |

**Revenue projection at scale:**

| Users | MAU | Conversion | Subscribers | MRR | ARR |
|-------|-----|------------|-------------|-----|-----|
| 10K downloads | 5K | 2.5% | 125 | $625 | $7.5K |
| 50K downloads | 25K | 2.5% | 625 | $3.1K | $37.5K |
| 200K downloads | 100K | 3% | 3,000 | $15K | $180K |
| 1M downloads | 400K | 3% | 12,000 | $60K | $720K |

#### Tier 2: B2B API — "Street Intelligence API"

License station-level safety scores, crowd estimates, and risk data to:

- **Real estate platforms** (StreetEasy, Zillow, Redfin) — neighborhood safety scores for listings near subway stations. Precedent: CrimeOMeter charges $1K-30K/yr for crime data APIs.
- **Travel & navigation apps** — transit safety context for route planning.
- **Insurance companies** — risk assessment for renters/property insurance.
- **Corporate travel/HR** — employee safety intelligence for companies with NYC offices.

| Tier | Price | Includes |
|------|-------|---------|
| Starter | $500/mo | 10K queries/mo, station safety scores |
| Growth | $2,000/mo | 100K queries/mo, + crowd data + hourly risk |
| Enterprise | $5,000+/mo | Unlimited, + custom analytics + SLA |

Even 5-10 B2B customers at $2K/mo = $120-240K ARR.

#### Tier 3: City Partnership

The Adams administration partnered with Citizen for free. We can pursue the same — not for direct revenue, but for:

- **Legitimacy and trust** (city endorsement)
- **Distribution** (MTA digital signage, city website links)
- **Data access** (direct feeds vs. scraping public APIs)
- **Grant eligibility** (NYC civic tech programs, BigApps)

This is a growth accelerator, not a revenue stream. Apply for it once the app has traction (10K+ MAU).

#### Tier 4: Aggregated Data Products (Later)

Anonymized, aggregated intelligence sold to urban planners and researchers:

- Station-level crowd pattern reports
- Safety trend analysis by neighborhood/time
- Anomaly detection insights

**Must be designed for NY Privacy Act compliance from day one.** Never sell raw location data. Never allow re-identification. The NYC taxi data re-identification incident is a permanent cautionary tale.

Comparable: Placer.ai ($100M ARR, $1.5B valuation) sells foot traffic analytics. StreetLight Data was acquired by Jacobs. This market is real but requires scale.

### What We Will NOT Do

- **Paywall real-time safety alerts** — ever
- **Sell raw user location data** — ever
- **Run ads next to safety content** — undermines credibility, CPMs are low anyway ($2-15), not worth the trust damage
- **Fear-monger for engagement** — no "5 MURDERS NEAR YOU" push notifications
- **Enable vigilantism** — no user-submitted incident reports without verification, no bounties (Citizen's worst moment)
- **Racial profiling** — no user comments, no suspect descriptions, no "suspicious person" reports

---

## Mobile Strategy

### Phase 1: PWA (Week 1) — $0

Convert current web app to Progressive Web App:

- Add `manifest.json` (app name, icons, theme, display: standalone)
- Add service worker (offline caching of models + last presence data)
- Add `<meta>` tags for iOS home screen
- Users can "Add to Home Screen" on both iOS and Android
- Feels like a native app, launches full-screen, works offline

**Limitations:** No push notifications on iOS (Apple restriction for PWAs). No App Store discovery. But it's free and immediate.

### Phase 2: Google Play via Capacitor (Week 2-3) — $25

Wrap existing vanilla JS + Mapbox GL app with Capacitor:

- Capacitor works directly with vanilla JS (no React/Vue needed)
- Generates Android Studio project from web app
- Add native features: push notifications, background location, haptics
- Submit to Google Play ($25 one-time fee)
- Google Play also accepts TWA (Trusted Web Activity) for PWAs

**Why Google first:** Faster approval (hours vs. days), cheaper ($25 vs $99/yr), more lenient about web-wrapped apps.

### Phase 3: Apple App Store (Week 4-6) — $99/year

Same Capacitor codebase, generates Xcode project:

- Apple requires apps to feel "native" — can't be a bare website wrapper
- Must add native-feeling features: haptic feedback on safety level changes, push notifications for disruptions near saved stations, iOS widgets showing current station safety
- Apple review takes 1-7 days, may require iteration

**Total cost to be on both stores: $124 first year, $99/year ongoing.**

### Phase 4: Native Features (Post-Launch)

Features that justify the native app and drive Pro subscriptions:

- **Push notifications**: "No Service at your saved station — 3 safe alternatives nearby"
- **Widgets**: iOS/Android home screen widget showing safety level at saved station
- **Apple Watch**: Glanceable safety level, haptic tap when entering caution/avoid station
- **Background alerts**: Geofence around saved stations, alert when conditions change
- **Shortcuts/Siri**: "Hey Siri, is my station safe right now?"

---

## Feature Roadmap

### Now (v4) — Performance + Mobile Foundation

- [ ] Performance optimization (lazy-load models, adaptive polling, battery management)
- [ ] Mobile responsive redesign (phone breakpoints, touch targets, collapsible HUD)
- [ ] PWA setup (manifest, service worker, offline support)
- [ ] Glow theme selection (from catalog)

### Next (v5) — App Store Launch

- [ ] Capacitor integration
- [ ] Push notification infrastructure
- [ ] Saved stations (localStorage → account system later)
- [ ] Google Play submission
- [ ] Apple App Store submission
- [ ] Onboarding flow (explain what the app does, request permissions)

### Later (v6) — Pro Features

- [ ] Pro subscription (Stripe/RevenueCat)
- [ ] Personal route safety planner
- [ ] Family/group sharing
- [ ] Historical analytics dashboard
- [ ] Weekly intelligence digest
- [ ] Custom geofence alerts

### Future (v7) — Platform

- [ ] B2B API (rate-limited, API keys, documentation)
- [ ] Account system (email/Apple/Google sign-in)
- [ ] Apple Watch app
- [ ] iOS widgets
- [ ] City partnership application
- [ ] Aggregated data products

---

## Cost Structure

### Current: $0/month

| Item | Cost | Notes |
|------|------|-------|
| Vercel hosting | $0 | Hobby plan, 10s function timeout (30s with config) |
| MTA GTFS-RT feeds | $0 | Free, public API |
| NYPD crime data | $0 | NYC Open Data, free |
| OpenWeather API | $0 | Free tier (1,000 calls/day) |
| Mapbox GL JS | $0 | Free tier (50K map loads/month) |

### At Scale: ~$50-200/month

| Item | Cost | Trigger |
|------|------|---------|
| Vercel Pro | $20/mo | When hobby limits hit (100GB bandwidth) |
| Mapbox | $0-50/mo | Free up to 50K loads, then $5/1K |
| OpenWeather | $0-40/mo | Free up to 1K/day, "One Call 3.0" at $0.0015/call |
| Push notification service | $0-25/mo | OneSignal free up to 10K subscribers |
| Apple Developer | $99/yr ($8/mo) | Required for App Store |
| Domain + email | $12/yr ($1/mo) | Professional presence |
| **Total** | **~$50-150/mo** | At 50K MAU |

### Revenue Breakeven

At $4.99/mo subscription with 2.5% conversion:

- **Breakeven (covering $150/mo costs):** 1,200 MAU → 30 subscribers → $150/mo
- **Ramen profitable ($3K/mo):** 24,000 MAU → 600 subscribers
- **Sustainable ($10K/mo):** 80,000 MAU → 2,000 subscribers
- **Add B2B:** 5 API customers at $2K/mo = $10K/mo additional

---

## Key Risks

| Risk | Mitigation |
|------|-----------|
| MTA kills free API access | Unlikely (public data mandate), but cache aggressively. Could scrape GTFS static as fallback. |
| Citizen copies our transit feature | First-mover advantage + open data moat. They'd need to rebuild from scratch. Their brand is already damaged. |
| Apple rejects web-wrapped app | Add enough native features (push, haptics, widgets) to pass review. Capacitor community has documented approval strategies. |
| NY Privacy Act passes | Design for compliance now. Never collect PII beyond what's needed. Anonymize everything. |
| Users perceive app as fear-mongering | Frame as empowerment, not fear. "Know before you go" not "DANGER EVERYWHERE." Show safe stations prominently. Default view is positive. |
| Mapbox costs at scale | Free up to 50K loads/month. At 200K MAU with daily use, ~$500/mo. Manageable with subscription revenue. Could switch to MapLibre (open source) as nuclear option. |

---

## Success Metrics

| Phase | Target | Timeline |
|-------|--------|----------|
| PWA launch | 500 installs, 200 weekly active | Month 1-2 |
| Google Play launch | 5,000 downloads, 4.0+ rating | Month 2-3 |
| Apple App Store launch | 10,000 downloads, 4.5+ rating | Month 3-4 |
| First revenue | 50 Pro subscribers ($250/mo) | Month 4-6 |
| Traction | 50K downloads, 20K MAU, $3K MRR | Month 6-12 |
| Sustainability | 200K downloads, 80K MAU, $10K+ MRR | Year 2 |
| B2B launch | 3+ API customers, $5K+ MRR | Year 2 |
| City partnership | MTA or NYC agency endorsement | Year 2-3 |

---

## The One-Liner

**Eyes on the Street: Free, real-time subway safety intelligence for every New Yorker. Know before you go.**
