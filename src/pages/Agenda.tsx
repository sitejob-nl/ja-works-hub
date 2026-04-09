import CalendarView from '@/components/calendar/CalendarView';

const Agenda = () => {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Agenda</h1>
        <p className="text-muted-foreground text-sm">Beheer je Outlook agenda — afspraken, gesprekken en uitnodigingen</p>
      </div>
      <CalendarView />
    </div>
  );
};

export default Agenda;
