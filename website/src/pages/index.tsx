import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import CodeBlock from '@theme/CodeBlock';
import LiveMapper from '@site/src/components/LiveMapper';
import {personInput, personMap} from '@site/src/examples/person';
import styles from './index.module.css';

const facts = [
  {
    title: 'A map is JSON',
    body: 'The editor saves a map as plain JSON, so it can sit in git next to your code. The core package runs it in Node or the browser, with no UI and no dependencies.',
  },
  {
    title: '41 operators',
    body: 'Text, numbers, logic, conversions and totals over repeating records. You can take out the ones you don\'t need and add your own.',
  },
  {
    title: 'Works with your framework',
    body: 'The editor is plain DOM, and the docs have a ready-made component for React, Vue, Svelte, Angular, Solid and Astro. It comes with 14 themes, or you can make your own.',
  },
];

export default function Home(): ReactNode {
  return (
    <Layout title="A visual mapper for JSON" description="Crosswalk is a visual mapper for JSON. Draw the lines between the shape you have and the shape you want.">
      <header className={styles.hero}>
        <div className="container">
          <Heading as="h1" className={styles.title}>
            Crosswalk
          </Heading>
          <p className={styles.tagline}>
            A visual mapper for JSON. Put the shape you have on the left and the shape you want on the right, then draw the lines between them.
          </p>
          <div className={styles.buttons}>
            <Link className="button button--primary button--lg" to="/docs/getting-started">
              Get started
            </Link>
            <Link className="button button--secondary button--lg" to="/playground">
              Open the playground
            </Link>
          </div>
          <CodeBlock language="bash" className={styles.install}>
            npm install @crosswalkjs/canvas @crosswalkjs/core
          </CodeBlock>
        </div>
      </header>
      <main>
        <section className="container">
          <h2 className={styles.sectionTitle}>The editor</h2>
          <p className={styles.hint}>
            This is the editor, mapping a person and their phone calls onto a profile. Hover a field to see where it goes, or click an operator to change it.
          </p>
          <LiveMapper map={personMap} input={personInput} height={500} open={{options: false}} />
        </section>
        <section className="container">
          <ul className={styles.features}>
            <li className={styles.featuresHead}>
              <h2 className={styles.sectionTitle}>What it is</h2>
            </li>
            {facts.map((fact) => (
              <li key={fact.title}>
                <Heading as="h3">{fact.title}</Heading>
                <p>{fact.body}</p>
              </li>
            ))}
          </ul>
        </section>
        <section className={`container ${styles.status}`}>
          <p>
            Crosswalk is at 0.1. It works, but <span className="highlight">the API may change before 1.0</span>. <Link to="https://github.com/crosswalkjs/crosswalk/issues">Issues</Link> are welcome.
          </p>
        </section>
      </main>
    </Layout>
  );
}
