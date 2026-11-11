import type {ReactNode} from 'react';
import Layout from '@theme/Layout';
import Playground from '@site/src/components/Playground';
import {blankPersonMap, personInput, personMap} from '@site/src/examples/person';
import {orderInput, orderMap} from '@site/src/examples/order';
import styles from './playground.module.css';

const examples = {
  person: {label: 'Person → profile', map: personMap, input: personInput},
  order: {label: 'Order → invoice', map: orderMap, input: orderInput},
  blank: {label: 'Start from scratch', map: blankPersonMap, input: personInput},
};

const help = (
  <>
    <p>Drag an operator from the toolbox onto the grid. Drag fields onto it, then its dot onto a target field.</p>
    <p>Click anything to edit it. Delete removes it, and Cmd/Ctrl+Z undoes.</p>
    <p>The panel beside the editor shows the output as you work. Change the input, open or paste a map on the Map tab, and watch what the editor reports on the Events tab.</p>
    <p>Nothing you do here is saved. Download the map from the Map tab to keep it.</p>
  </>
);

export default function PlaygroundPage(): ReactNode {
  return (
    <Layout title="Playground" description="Try the Crosswalk editor in your browser." noFooter>
      <main>
        <h1 className={styles.title}>Playground</h1>
        <Playground examples={examples} help={help} />
      </main>
    </Layout>
  );
}
