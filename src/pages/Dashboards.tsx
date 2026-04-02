import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import TimeToHireDashboard from '@/components/dashboard/TimeToHireDashboard';
import DataQualityDashboard from '@/components/dashboard/DataQualityDashboard';
import SourceAnalysisDashboard from '@/components/dashboard/SourceAnalysisDashboard';
import ActivityDashboard from '@/components/dashboard/ActivityDashboard';

const Dashboards = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboards</h1>
        <p className="text-sm text-muted-foreground">Analyse en inzichten over recruitment, datakwaliteit en activiteiten.</p>
      </div>

      <Tabs defaultValue="time-to-hire">
        <TabsList>
          <TabsTrigger value="time-to-hire">Time-to-hire</TabsTrigger>
          <TabsTrigger value="data-quality">Datakwaliteit</TabsTrigger>
          <TabsTrigger value="source-analysis">Bronanalyse</TabsTrigger>
          <TabsTrigger value="activity">Activiteiten</TabsTrigger>
        </TabsList>

        <TabsContent value="time-to-hire" className="mt-4">
          <TimeToHireDashboard />
        </TabsContent>
        <TabsContent value="data-quality" className="mt-4">
          <DataQualityDashboard />
        </TabsContent>
        <TabsContent value="source-analysis" className="mt-4">
          <SourceAnalysisDashboard />
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <ActivityDashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Dashboards;
