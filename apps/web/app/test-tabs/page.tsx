"use client";

import { Tabs, TabList, Tab, TabPanel } from "@/components/Tabs";

export default function TabsTest() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl mb-4">Tabs-Component Manual-Test</h1>
      <p className="text-sm text-muted mb-6">
        7 Test-Pfade: Initial-Tab, URL-Update on Click, Keyboard Arrow/Home/End,
        Disabled-Skip, Sub-Tabs, URL-Init bei Reload.
      </p>

      <Tabs defaultTab="a" persistInUrl paramName="tab">
        <TabList>
          <Tab id="a">Tab A</Tab>
          <Tab id="b">Tab B</Tab>
          <Tab id="c" disabled>Tab C (disabled)</Tab>
          <Tab id="d">Tab D mit Sub-Tabs</Tab>
        </TabList>

        <TabPanel id="a">
          <p>Content A — sollte initial sichtbar sein.</p>
        </TabPanel>

        <TabPanel id="b">
          <p>Content B</p>
        </TabPanel>

        <TabPanel id="c">
          <p>Content C — niemals sichtbar (Tab disabled).</p>
        </TabPanel>

        <TabPanel id="d">
          <p className="mb-4">Tab D Inhalt mit verschachtelten Sub-Tabs:</p>
          <Tabs defaultTab="x" persistInUrl paramName="sub">
            <TabList>
              <Tab id="x">Sub X</Tab>
              <Tab id="y">Sub Y</Tab>
            </TabList>
            <TabPanel id="x">Sub Content X</TabPanel>
            <TabPanel id="y">Sub Content Y</TabPanel>
          </Tabs>
        </TabPanel>
      </Tabs>
    </div>
  );
}
