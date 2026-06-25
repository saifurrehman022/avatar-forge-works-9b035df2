import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { AppHeader } from "@/components/dashboard/app-header";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";


export const Route = createFileRoute("/_authenticated/generate")({
  component: GeneratePage,
});


function GeneratePage() {


  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");



  const RUNPOD_API_KEY =
    import.meta.env.VITE_RUNPOD_API_KEY;


  const RUNPOD_ENDPOINT_ID =
    import.meta.env.VITE_RUNPOD_ENDPOINT_ID;



  async function generate() {


    setLoading(true);
    setError("");
    setResult(null);



    try {


      const res = await fetch(

        `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/run`,

        {

          method: "POST",

          headers: {

            "Content-Type": "application/json",

            Authorization:
              `Bearer ${RUNPOD_API_KEY}`

          },


          body: JSON.stringify({

            input: {

              prompt: prompt

            }

          })

        }

      );



      const data = await res.json();



      if (!res.ok) {

        throw new Error(
          JSON.stringify(data)
        );

      }


      setResult(data);



    } catch(e:any) {


      setError(e.message);



    } finally {


      setLoading(false);


    }


  }



  return (

    <SidebarProvider>


      <div className="flex min-h-screen w-full">


        <AppSidebar />


        <SidebarInset>


          <AppHeader />


          <main className="p-8">


            <Card>


              <CardHeader>


                <CardTitle>
                  AI Generator
                </CardTitle>


              </CardHeader>



              <CardContent className="space-y-5">


                <Textarea

                  value={prompt}

                  onChange={(e)=>
                    setPrompt(e.target.value)
                  }

                  placeholder="Enter prompt..."

                  rows={6}

                />



                <Button

                  onClick={generate}

                  disabled={loading}

                >

                  {
                    loading
                    ?
                    "Generating..."
                    :
                    "Generate"

                  }


                </Button>



                {
                  error &&

                  <pre className="text-red-500">

                    {error}

                  </pre>

                }



                {
                  result &&

                  <pre className="border p-4 overflow-auto">

                    {JSON.stringify(result,null,2)}

                  </pre>

                }


              </CardContent>


            </Card>


          </main>


        </SidebarInset>


      </div>


    </SidebarProvider>


  );


}
