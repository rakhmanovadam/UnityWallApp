import RequestForm from "./form";

export default function RequestPage() {
  return (
    <section className="screen screen--scroll">
      <header className="apply__head">
        <span className="kicker kicker--dusk">Apply to host</span>
        <h1 className="display display--sm">Tell us about your venue</h1>
      </header>
      <RequestForm />
    </section>
  );
}
