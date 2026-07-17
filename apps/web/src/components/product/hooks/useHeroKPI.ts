import { useState, useEffect } from "react";

export function useHeroKPI() {
  const [kpi, setKpi] = useState({ owed: 0, students: 0, ledgers: 0 });

  useEffect(() => {
    // In a real application, this would fetch from the API Gateway
    // For the landing page, we use a simulation or static initial data
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKpi({
      owed: 124500, // stored as paise/rupees depending on the spec, but we format it as ₹1,24,500
      students: 38,
      ledgers: 1,
    });
  }, []);

  return kpi;
}
