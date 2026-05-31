import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { Navbar } from "@/components/Navbar";
import { StatsLanding } from "@/components/landing/Stats";
import { PreviewLanding } from "@/components/landing/Preview";
import { HowItWorksLanding } from "@/components/landing/HowItWorks";
import { FeatureGridLanding } from "@/components/landing/FeatureGrid";
import { TestimonialsLanding } from "@/components/landing/Testimonials";
import { FaqLanding } from "@/components/landing/Faq";
import { CtaBannerLanding } from "@/components/landing/CtaBanner";

// Static landing — pre-rendered to /out/index.html at build time. Zero
// client JS until the user clicks something interactive (theme toggle,
// signup form). Sections live in `components/landing/*` so /about and
// /policy can reuse the same chrome + section primitives.
export default function HomePage() {
  return (
    <>
      <Navbar />
      <Hero />
      <StatsLanding />
      <PreviewLanding />
      <HowItWorksLanding />
      <FeatureGridLanding />
      <TestimonialsLanding />
      <FaqLanding />
      <CtaBannerLanding />
      <Footer />
    </>
  );
}
