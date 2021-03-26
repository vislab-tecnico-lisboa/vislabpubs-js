/************************************************
 *  vislab_pubs.js - v0.2, March 2021
 *  
 *  By Joao Avelino and Pedro Vicente, 2021
 *  Based on code from https://www.ipfn.tecnico.ulisboa.pt/engineering/publications.html
 *  
 *  Updates:
 *  - Writes the full reference with authors, journals / conferences, month (when available)
 *  - Parses the bibtex if the conference name is not available
 *  - Attempts to recover from orcid query failures
 *  - Aggregates information from multiple authors instead of just using first author it finds
 *  - Plots the number of papers per year
 *  - Only writes the html when all queries are handled / completed
 *  - Uses cached values to avoid unecessary queries to orcid
 *  - For each year, papers can be loaded dynamically from orcid or hardcoded 
 *      (if the list for a specific year exists, then the script will not call orcid
 *      and the page maintainter will be responsible for the papers of that year)
 *  - Added "loading" animation to inform the user that the script is fetching papers
 *  - Attempts to fix mismatches between publication year and conference year (assumes conference year
 * as the correct value)
 *  - Adds PDF link if available
 * 
 ************************************************/


const MONTH_NAMES = [
	'January', 'February', 'March', 'April', 'May',
	'June', 'July', 'August', 'September',
	'October', 'November', 'December'
];

const PUTCODE_FETCH_TIME = 5;
const AUTHOR_FETCH_TIME = 5;
const FIRST_YEAR = 1993;

const NAMES_TO_CORRECT = {
    "Simo, H.": "Simão, H.",
    "Aráujo, H." :"Araújo, H."
}

const orcidList = [
"0000-0002-9036-1728", "José Santos-Victor", [1993,9999],
"0000-0003-3991-1269","Alexandre Bernardino",[1993,9999],
"0000-0002-9502-2151", "José Gaspar", [1993,9999],
"0000-0002-3800-7756", "Jorge Salvador Marques",[1993,9999],
"0000-0002-0496-2050", "Plinio Moreno",[1993,9999],
"0000-0002-2852-7723", "Catarina Barata",[2000,9999],
"0000-0003-3678-4823", "João Avelino",[2015,9999],
"0000-0002-9678-9055", "Pedro Vicente", [2013,9999],
"0000-0002-7332-3391", "Ricardo Ribeiro", [2005, 9999]
];

const doi_to_not_include = [
    "10.1007/978-3-540-79142-3_12",		
];

const PDF_PATH = "http://vislab.isr.ist.utl.pt/wp-content/uploads/paper_pdfs/"


const DYNAMIC_PAPERS_DIV_ID = "myPublications";

var hardcoded_years = []
var dynamic_years = []
var selected_year = new Date().getFullYear();
var year = new Date();
var counter_for_plot = {};

//Adapted from https://stackoverflow.com/questions/61597868/creating-and-downloading-text-file-from-string-in-javascript-blob-createobjectu
function dl_as_file_Blob(DOI) {

	data_to_dl = PapersByDOI[DOI].citationValue;
	let blobx = new Blob([data_to_dl], { type: 'text/plain' }); // ! Blob
	let elemx = window.document.createElement('a');
	elemx.href = window.URL.createObjectURL(blobx); // ! createObjectURL
	elemx.download = DOI + ".bib";
	elemx.style.display = 'none';
	document.body.appendChild(elemx);
	elemx.click();
	document.body.removeChild(elemx);
}


// create author string (Joao Avelino)
function createAuthorsString(authors_raw) {

	var authors_string = "";

	for (var i = 0; i < authors_raw.length; i++) {
		var raw_name_str = authors_raw[i]["credit-name"].value;
		var firstName;
		var surname;

		//Check if the name needs corrections
		if (raw_name_str in NAMES_TO_CORRECT)
			raw_name_str = NAMES_TO_CORRECT[raw_name_str];

		//Verify if a comma is separating the names or not... 
		if (raw_name_str.indexOf(',') > -1) {
			var raw_name_arr = raw_name_str.split(", ");
			firstName = raw_name_arr[1][0] + ". ";
			surname = raw_name_arr[0];
		} else {
			var raw_name_arr = raw_name_str.split(" ");
			firstName = raw_name_arr[0][0] + ". ";
			surname = raw_name_arr[raw_name_arr.length - 1];
		}


		if (i == authors_raw.length - 2)
			authors_string += firstName + surname + ", and ";
		else
			authors_string += firstName + surname + ", ";

	}

	return authors_string
}


class Paper{
    constructor(publicationName, publicationYear, publicationType, DOI)
    {
       this.title = publicationName 
       this.authors = null
       this.DOI = DOI
       this.journalName = null
       this.publicationYear = publicationYear
       this.source = null
       this.publicationType = publicationType
       this.citationType = null
       this.citationValue = null
       this.month = null
       this.orcid_putcodelist_pair = []
       this.pdf_link = null
       this.try_pdf_link = null
    }

    updatePaperFromData(data, elementID, paper_list, year_list){


        var title = data["title"]["title"].value;

        if (data["title"]["subtitle"] != null) {
            title += ". " + data["title"]["subtitle"].value;
        }
        
        if(title != null && title != "")
            this.title = title;


        var authors_raw = data["contributors"]["contributor"];
        var authors = createAuthorsString(authors_raw);

        if(authors != null && authors != "")
            this.authors = authors;

        var month = null
        if (data["publication-date"]["month"] != null) {
            month = data["publication-date"]["month"].value;
            var monthNumber = parseInt(month, 10);
            if (!isNaN(monthNumber)) {
                month = MONTH_NAMES[monthNumber - 1]
            }
        }

        if(month != null && month != "")
        {
            this.month = month;
        }

        

        var jornal_name = null
        if (data["journal-title"] != null)
            jornal_name = data["journal-title"].value;
        else {
            //Lets find the conference name by parsing the bibtex...
            if (citation != null && citation["citation-type"] == "BIBTEX") {
                var cit_text = citation["citation-value"];
                if (cit_text.indexOf("inproceedings") > -1 || cit_text.indexOf("inproceedings") > -1) {
                    var idx_tmp = cit_text.indexOf("booktitle");
                    idx_tmp = idx_tmp + cit_text.substring(idx_tmp).indexOf("=");
                    var delimiter;
                    for (var c_idx = idx_tmp + 1; c_idx < cit_text.length; c_idx++) {
                        if (!(cit_text[c_idx] == " ")) {
                            delimiter = cit_text[c_idx];
                            idx_tmp = c_idx;
                            break;
                        }
                    }
                    if (delimiter == "{")
                        delimiter = "}"

                    if (delimiter == "\"" || delimiter == "}") {
                        text_full = cit_text.substring(idx_tmp + 1);
                        text_full = text_full.split(delimiter + ",");

                        jornal_name = text_full[0];
                    } else {
                        jornal_name = null;
                    }

                }
            }

        }

        if(jornal_name != null && jornal_name != "")
            this.journalName = jornal_name;

        //Add bibtex citation info
        var citation = data["citation"];
        if (citation != null && citation["citation-type"] == "BIBTEX")
        {
            this.citationType = citation["citation-type"];
            this.citationValue = citation["citation-value"];
        }


        var year = null;
        if (data["publication-date"]["year"] != null)
            year = data["publication-date"]["year"].value;

        //Sometimes the publication year does not match the conference year.
        //When this happens, the conference year is the previous year check if 
        //it is described in the conference name

        if(jornal_name != null && year != null && this.journalName.search(year-1) != -1)
        {
            var old_year = year;
            year = year-1;

            //Correct the paper category in the PapersByYear dictionary
            if(!(year in PapersByYear))
            {
                PapersByYear[year] = [];
            }

            PapersByYear[year].push(this);
            var i;
            for(i = 0; i < PapersByYear[old_year].length; i++)
            {
                if(PapersByYear[old_year][i] == this)
                {
                  PapersByYear[old_year].splice(i, 1);
                  var re = new RegExp(old_year, "g");
                  this.citationValue = this.citationValue.replace(re, year.toString());
                  break;
                }
            }
        }
        
        if(year != null && year != "")
            this.year = year


        //Add source information
        this.source = data["source"]["source-name"].value


        //Check if the pdf file is available

        var pdf_url = PDF_PATH+this.getPDFname();
        this.try_pdf_link = pdf_url;

        count_updates++;

        
        var request = new XMLHttpRequest();
        var this_paper = this;

        pdf_calls ++;
        request.open('GET', pdf_url, true);
        request.timeout = 10;
        request.onreadystatechange = function(){
            if (request.readyState === 4){
                if (request.status === 200) {  
                    this_paper.pdf_link = pdf_url;
                }  
            }
            pdf_calls--;
        };
        try{
            request.send();
        }
        catch(error)
        {
            pdf_calls--;
            console.log(error)
        }
        

    }

    toHTML()
    {
        var month_str = "";
        if(this.month != null)
        {
            month_str = this.month;
        }
        var html_code = ""
        var bibtex_download = "<a id='bib_" + this.DOI + "' title='Cite this paper' href='#' onclick='dl_as_file_Blob(\"" + this.DOI + "\");return false;'>[Cite]</a>";

        var pdf_download;

        if(this.pdf_link == null)
        {
            pdf_download = "<span title='Cannot find file: "+this.try_pdf_link+"'>[PDF]</span>"
        }else{
            pdf_download = "<a href='"+this.pdf_link+"'>[PDF]</a>";
        }

        html_code += "<a href='https://doi.org/" + this.DOI + "'>";
        html_code += "<strong>" + this.title + "</a>,</strong> <em>" + this.authors + "</em>" + this.journalName + ", " + month_str + " " + this.year + " " + bibtex_download;
        html_code += pdf_download;

        return html_code
    }
    getPDFname()
    {
       //Name structure - year_[first letter of first name][surname]_[first 4 letters of title]_[last 4 letters of title].pdf
       var pdf_name = ""
       var name_str_lst = this.authors.split(",")[0].split(". ");
       var title_last = this.title.slice(-4);
       var title_first = this.title.substr(0, 4);
       pdf_name += pdf_name+this.year+"_"+name_str_lst[0]+name_str_lst[1]+"_"+title_first+"_"+title_last+".pdf";
       return pdf_name.toLowerCase();
    }
};

function organizePapersByYearAndPlot()
{

    //Organize papers by year

    if(Object.keys(PapersByYear).length < 1)
    {
        console.log("Organizing...");

        for(var d in PapersByDOI)
        {
            var year = PapersByDOI[d].publicationYear;
            if(!(year in PapersByYear))
            {
                PapersByYear[year] = [];
            }

            PapersByYear[year].push(PapersByDOI[d]);
        }
        console.log("Done")

    }

    for(var i = 0; i < dynamic_years.length; i++)
    {
        counter_for_plot[dynamic_years[i]] = PapersByYear[dynamic_years[i]].length;
    }


    //Plot the number of papers

    // convert struct in {"year": key, "count":value}
    var counter_for_plot2 = Object.entries(counter_for_plot).map(([key, value]) => ({"year": key, "count": value}));
    am4core.ready(function() {

        // Themes begin
        am4core.useTheme(am4themes_animated);
        // Themes end

        // Create chart instance
        var chart = am4core.create("chartdiv", am4charts.XYChart);

        // Add data
        chart.data = counter_for_plot2;
        var categoryAxis = chart.xAxes.push(new am4charts.CategoryAxis());
        categoryAxis.dataFields.category = "year";
        categoryAxis.renderer.grid.template.location = 0;
        categoryAxis.renderer.minGridDistance = 30;

        categoryAxis.renderer.labels.template.adapter.add("dy", function(dy, target) {
	    if (target.dataItem && target.dataItem.index & 2 == 2) {
	        return dy + 25;
	    }
	    return dy;
        });

        var valueAxis = chart.yAxes.push(new am4charts.ValueAxis());

        // Create series
        var series = chart.series.push(new am4charts.ColumnSeries());
        series.dataFields.valueY = "count";
        series.dataFields.categoryX = "year";
        series.name = "Number of Articles";
        series.columns.template.tooltipText = "{categoryX}: [bold]{valueY}[/]";
        series.columns.template.fillOpacity = .8;

        var columnTemplate = series.columns.template;
        columnTemplate.strokeWidth = 2;
        columnTemplate.strokeOpacity = 1;
        var title = chart.titles.create();
        title.text = "Number of Articles per year";
        title.fontSize = 25;
        title.marginBottom = 30;

    }); // end am4core.ready()


    updateHTML(selected_year);

}

function updateHTML(selected_year)
{

    var loader_state = document.getElementById("loader").style.display;

    if(loader_state == "inline")
        return
    
    drawYearsTab(selected_year)

    //Hide all divs inside the the DYNAMIC_PAPERS_DIV_ID div
    //except the selected year

    var year_lists = document.getElementById(DYNAMIC_PAPERS_DIV_ID).children;

    for(var y = 0; y < year_lists.length; y++)
    {
        if(year_lists[y].id.split("_")[1] != selected_year)
        {
            year_lists[y].style.display = "none";
        }else{
            year_lists[y].style.display = "inline";
        }
    }

    if(year_in_dynamic_list(selected_year))
    {
        var list_of_papers = [...PapersByYear[selected_year]]
        writePapersByYear(DYNAMIC_PAPERS_DIV_ID, list_of_papers, selected_year)
        document.getElementById("loader").style.display = "inline";
    }

}


function writePapersByYear(elementID, paper_list, year)
{
    //If we do not have papers to process
    if(paper_list.length < 1)
    {

        //Did not finish all pdf calls yet, retry
        if(pdf_calls > 0)
        {
            setTimeout(function() {
                writePapersByYear(elementID, paper_list, year);
            }, 50);

            console.log("PDF calls not ready yet, retrying")
            return;
        }

        console.log("Writting papers")

        writeHTMLlistOfPapersByYear(elementID, year)

    }else{

        console.log("Getting extra data...")
        getExtraPapersData(elementID, paper_list, year)

    }

}

function writeHTMLlistOfPapersByYear(elementID, year)
{
    var year_lists = document.getElementById(elementID).children;

    var done = false;

    for (var i = 0; i < year_lists.length && !done; i++) {
        if(year_lists[i].id == "pubs_"+year)
            break;
        else if(i+1 == year_lists.length)
        {

            //Create list html

            

            var html_code = '<ul id="pubs_'+year+'">';

            for(var p = 0; p < PapersByYear[year].length; p++)
            {
                html_code += '<li>';
                html_code += PapersByYear[year][p].toHTML();
                html_code += '</li>';
            }

            html_code += '</ul>'

            //Get the element immediately after
            for(var j = 0; j < year_lists.length && !done; j++)
            {
            
                var res = year_lists[j].id.split("_");

                if(res[1] > year)
                {
                    year_lists[j].insertAdjacentHTML("beforebegin", html_code)
                    done = true;
                }else if(year_lists.length == j+1)
                {
                    year_lists[j].insertAdjacentHTML("beforebegin", html_code)
                    done = true;
                }
            }

            if(year_lists.length == 0)
            {
                var year_l = document.getElementById(DYNAMIC_PAPERS_DIV_ID);
                year_l.innerHTML = html_code;
            }

        }
    }

    document.getElementById("loader").style.display = "none";

}



class CallStack{
    constructor(function_to_execute)
    {
        this.stuff_to_load = 0
        this.function_to_execute = function_to_execute
    }

    updateCallStackCounterAndExecuteIfReady(value_update)
    {
        this.stuff_to_load += value_update;	

        if(this.stuff_to_load == 0)
        {
            this.function_to_execute();
        }
    }
    updateCallStackCounterAndExecuteIfReady(value_update, arg1, arg2, arg3)
    {
        this.stuff_to_load += value_update;	

        if(this.stuff_to_load == 0)
        {
            this.function_to_execute(arg1, arg2, arg3);
        }
    }
    
};

var PapersByDOI = {};
var PapersByYear = {};
var CountPapersCompletedByYear = {};

var callStackAuthorQuery = new CallStack(organizePapersByYearAndPlot);
var callStackFetchPutcode = new CallStack(getExtraPapersData);
var pdf_calls = 0;

//Debug
var count_requests = 0
var count_updates = 0


// find if the DOI is included in the list of DOIs to not be included
function in_doi_to_not_include(DOI) {
	for (var f = 0; f < doi_to_not_include.length; f++) {
		if (doi_to_not_include[f].toUpperCase() == DOI.toUpperCase()) {
			return true;
		}
	}
	return false;
}

// check if year is in the dynamic list
function year_in_dynamic_list(year)
{
    for(var y = 0; y < dynamic_years.length; y++)
    {
        if(dynamic_years[y] == year)
        {
            return true;
        }
    }

    return false;
}

// find if the DOI was published during the contract of the respective member
function in_member_contract(orcidID, DOI_publicationYear) {
	for (f = 0; f < orcidList.length / 3; f++) {
		if (orcidList[3 * f].toUpperCase() == orcidID.toUpperCase()) {
			for (g = 0; g < orcidList[3 * f + 2].length / 2; g++) {
				if (Number(DOI_publicationYear) >= orcidList[3 * f + 2][2 * g] & Number(DOI_publicationYear) <= orcidList[3 * f + 2][2 * g + 1])
					return true;
			}
			return false;
		}
	}
	return false;
}


function fillPapersFromAuthorQuery(data)
{
    for (var i in data.group){
    //Get info from the best sources: scopus, crossref. If they fail get what remains...
    //I believe this will be a more successful approach (Joao Avelino)
        if (data.group[i]["external-ids"]["external-id"]["length"] != 0) {
            var DOI = [];
            var orcidID = data.group[i]["work-summary"]["0"]["path"].split('/')[1]
            var putcode = [];
            var publicationName
            var publicationYear

            for (j = 0; j < data.group[i]["external-ids"]["external-id"]["length"]; j++) {
                if (data.group[i]["external-ids"]["external-id"][j]["external-id-type"] == "doi") {
                    DOI = data.group[i]["external-ids"]["external-id"][j]["external-id-value"].toUpperCase();

                    //Search for scopus source to get the put-code
                    putcode = "";

                    for (ws = data.group[i]["work-summary"].length - 1; ws >= 0; ws--) {
                        if (data.group[i]["work-summary"][ws]["source"]["source-name"].value == "Scopus - Elsevier") {
                            putcode = data.group[i]["work-summary"][ws]["put-code"];
                            publicationType = data.group[i]["work-summary"][ws]["type"];

                            if (data.group[i]["work-summary"][ws].title.title != null)
                                publicationName = data.group[i]["work-summary"][ws].title.title.value;
                            else
                                publicationName = "";

                            if (data.group[i]["work-summary"][ws]["publication-date"] != null)
                                publicationYear = data.group[i]["work-summary"][ws]["publication-date"].year.value;
                            else
                                publicationYear = "";
                            break;
                        }
                    }

                    //If scopus is not available check crossref
                    if (putcode == "") {
                        for (ws = data.group[i]["work-summary"].length - 1; ws >= 0; ws--) {
                            if (data.group[i]["work-summary"][ws]["source"]["source-name"].value == "Crossref") {
                                putcode = data.group[i]["work-summary"][ws]["put-code"];
                                publicationType = data.group[i]["work-summary"][ws]["type"]

                                if (data.group[i]["work-summary"][ws].title.title != null)
                                    publicationName = data.group[i]["work-summary"][ws].title.title.value;
                                else
                                    publicationName = "";

                                if (data.group[i]["work-summary"][ws]["publication-date"] != null)
                                    publicationYear = data.group[i]["work-summary"][ws]["publication-date"].year.value;
                                else
                                    publicationYear = "";
                                break;
                            }
                        }
                    }

                    //Otherwise, use the last source, not the first. Luckily it will
                    //be more up to date...
                    if (putcode == "") {
                        putcode = data.group[i]["work-summary"][data.group[i]["work-summary"].length - 1]["put-code"];
                        publicationType = data.group[i]["work-summary"][data.group[i]["work-summary"].length - 1]["type"]
                        publicationName = data.group[i]["work-summary"][data.group[i]["work-summary"].length - 1].title.title.value;

                        if (data.group[i]["work-summary"][data.group[i]["work-summary"].length - 1].title.title != null)
                            publicationName = data.group[i]["work-summary"][data.group[i]["work-summary"].length - 1].title.title.value;
                        else
                            publicationName = "";

                        if (data.group[i]["work-summary"][data.group[i]["work-summary"].length - 1]["publication-date"] != null)
                            publicationYear = data.group[i]["work-summary"][data.group[i]["work-summary"].length - 1]["publication-date"].year.value;
                        else
                            publicationYear = "";

                    }

                }
            }

            if ((publicationType == "JOURNAL_ARTICLE" || publicationType == "CONFERENCE_PAPER"
                || publicationType == "CONFERENCE_POSTER" || publicationType == "BOOK_CHAPTER" ||
                publicationType == "BOOK" || publicationType == "CONFERENCE_ABSTRACT" ||
                publicationType == "EDITED_BOOK" || publicationType == "JOURNAL_ISSUE" ||
                publicationType == "REPORT") && (publicationYear != "" && publicationName != "" &&
                DOI.length  && !in_doi_to_not_include(DOI) && in_member_contract(orcidID, publicationYear)
                && year_in_dynamic_list(publicationYear))) {

                        //If the paper is still not in the database, create it a add it
                        if (!(DOI in PapersByDOI))
                        {
                            PapersByDOI[DOI] = new Paper(publicationName, publicationYear, publicationType, DOI);
                        }

                        //If the paper information is complete and uses scopus data,
                        //there is no need to make more queries
                        var ok = (PapersByDOI[DOI].title != null && PapersByDOI[DOI].authors != null
                            && PapersByDOI[DOI].journalName != null && PapersByDOI[DOI].publicationYear != null
                            && PapersByDOI[DOI].month != null && PapersByDOI[DOI].source == "Scopus - Elsevier");

                        if(!ok)
                        {
                            orcid_putcodelist_pair = [orcidID, putcode];
                            PapersByDOI[DOI].orcid_putcodelist_pair.push(orcid_putcodelist_pair)
                        }
                        
            }


        }
    }


}


function fetchSingleAuthor(orcidIDList)
{

    if(orcidIDList.length > 0)
    {
        var orcidID = orcidIDList.pop();
        const ORCIDLink = "https://pub.orcid.org/v2.0/" + orcidID + "/works";

        fetch(ORCIDLink, {
            headers: {
                "Accept": "application/orcid+json"
            }
        })
            .then(
                function (response) {
                    if (response.status !== 200) {
                        console.log('Looks like there was a problem. Status Code: ' +
                            response.status);
                        document.getElementById("Error_msgs").innerHTML = "Problem loading references: " + response.status + "<br> Please reload the page!";
                        callStackAuthorQuery.updateCallStackCounterAndExecuteIfReady(-1);                        

                        setTimeout(function() {
                            fetchSingleAuthor(orcidIDList);
                        }, AUTHOR_FETCH_TIME);
                    }
                    // Examine the text in the response
                    response.json().then(function (data){
                    fillPapersFromAuthorQuery(data);
                    callStackAuthorQuery.updateCallStackCounterAndExecuteIfReady(-1);

                    setTimeout(function() {
                        fetchSingleAuthor(orcidIDList);
                    }, AUTHOR_FETCH_TIME);
                });
                })
            .catch(function (err) {
                console.log('Fetch Error :-S', err);

                //Try again but slow down!
                orcidIDList.push(orcidID);

                setTimeout(function() {
                    fetchSingleAuthor(orcidIDList);
                }, 10*AUTHOR_FETCH_TIME);
            });


    }


}


//Initialize publications
function getAuthorPubs()
{
    
    
    //Check which range of years we need to fetch and which years are hardcoded
    var all_years = []

    for(var y = year.getFullYear(); y >= FIRST_YEAR; y--)
    {
        all_years.push(y);
    }

    var year_lists = document.getElementById(DYNAMIC_PAPERS_DIV_ID).children;

    for(var i = 0; i < year_lists.length; i++)
    {
        var y = year_lists[i].id.split("_")[1];
        hardcoded_years.push(y);

        counter_for_plot[y] = document.getElementById("pubs_"+y).children.length;
    }

    for(var i = 0; i < all_years.length; i++)
        for(var j = 0; j < hardcoded_years.length; j++)
        {
            if(all_years[i] == hardcoded_years[j])
            {
                break;
            }else if(j+1 == hardcoded_years.length)
            {
                dynamic_years.push(all_years[i]);
            }
        }
    
    

    callStackAuthorQuery.updateCallStackCounterAndExecuteIfReady(orcidList.length / 3);

    for (var j = 0; j < orcidList.length / 3; j++)
    {
       fetchSingleAuthor([orcidList[3 * j]])
    }

}

function drawYearsTab(selectedYear)
{
    document.getElementById("Years").innerHTML = "";

    for(var i = year.getFullYear(); i>=FIRST_YEAR; i--)
    {
        if(i == selectedYear)
            document.getElementById("Years").innerHTML = document.getElementById("Years").innerHTML + '<a href="javascript:updateHTML(' + i + ')"><b><font color="#fbaa27">' + i + '</font></b></a> &nbsp;&nbsp;&nbsp; ';
        else
            document.getElementById("Years").innerHTML = document.getElementById("Years").innerHTML + '<a href="javascript:updateHTML(' + i + ')"><b>' + i + '</b></a> &nbsp;&nbsp;&nbsp; ';

    }
}


/* If we get data too fast the fetch will start to fail (probably orcid rejecting the query) */
/* Retry it and slow it down!*/

function fetchSinglePutcode(doi_org, orcidID, putcode, paper_list, year, elementID)
{

    var ORCIDLink = "https://pub.orcid.org/v2.0/" + orcidID + "/work/" + putcode;

    if(doi_org != "")
    {
        var ok = (PapersByDOI[doi_org].title != null && PapersByDOI[doi_org].authors != null
            && PapersByDOI[doi_org].journalName != null && PapersByDOI[doi_org].publicationYear != null
            && PapersByDOI[doi_org].source == "Scopus - Elsevier");

        if(ok)
        {
            callStackFetchPutcode.updateCallStackCounterAndExecuteIfReady(-1, elementID, paper_list, year);
            return;
        }
            
    }

    fetch(ORCIDLink,
        {
            headers: {
                "Accept": "application/orcid+json"
            }
        })
        .then(
            function (response) {
                if (response.status !== 200) {
                    console.log('Looks like there was a problem. Status Code: ' +
                        response.status);
                    //document.getElementById("Error_msgs").innerHTML = "Problem loading references: " + response.status +"<br> Please reload the page!";
                    setTimeout(function() {
                        fetchSinglePutcode(doi_org, orcidID, putcode, paper_list, year, elementID);
                    }, PUTCODE_FETCH_TIME);
                }
                response.json().then(function (data) {
                    if(data["response-code"] == 404)
                    {
                        document.getElementById("Error_msgs").innerHTML = "Failed to get some data from ORCID. Please reload the page."
                        callStackFetchPutcode.updateCallStackCounterAndExecuteIfReady(-1, elementID, paper_list, year);
                        return;
                    }
                    var doi = "";
                    for(var i = 0; i < data["external-ids"]["external-id"].length; i++)
                    {
                        if(data["external-ids"]["external-id"][i]["external-id-type"].toUpperCase() == "DOI")
                        {
                            doi = data["external-ids"]["external-id"][i]["external-id-value"].toUpperCase() 
                            break;
                        }
                    }

                    PapersByDOI[doi].updatePaperFromData(data, elementID, paper_list, year);
                    callStackFetchPutcode.updateCallStackCounterAndExecuteIfReady(-1, elementID, paper_list, year)

                });

            }
        )
        .catch(function (err) {
            console.log('Fetch Error :-S', err);
            
            //Try again but slow down!
            setTimeout(function() {
                fetchSinglePutcode(doi_org, orcidID, putcode, paper_list, year, elementID);
            }, 10*PUTCODE_FETCH_TIME)
        });


}

function getExtraPapersData(elementID, paper_list, year)
{
    if(paper_list.length < 1)
    {
        setTimeout(function() {
            writePapersByYear(elementID, paper_list, year);
        }, 0)

        return;
    }

    while(paper_list[0].orcid_putcodelist_pair < 1)
    {
        paper_list.shift();

        if(paper_list.length < 1)
        {
            setTimeout(function() {
                writePapersByYear(elementID, paper_list, year);
            }, 0)

            return;
        }
    }

    var calls = paper_list[0].orcid_putcodelist_pair.length;
    callStackFetchPutcode.updateCallStackCounterAndExecuteIfReady(calls, elementID, paper_list, year)

    //Process all orcidID-putcode pairs associated with this paper
    while(paper_list[0].orcid_putcodelist_pair.length > 0)
    {
        var pair = paper_list[0].orcid_putcodelist_pair.pop();
        var orcidID = pair[0];
        var putcode = pair[1];
        fetchSinglePutcode(paper_list[0].DOI, orcidID, putcode, paper_list, year, elementID)
    }
    
}


getAuthorPubs();


//bibteste = "@InProceedings{coias2020assessment, author= {Ana Rita C\\'{o}ias and Alexandre Bernardino}, title= {Assessment of Motor Compensation Patterns in Stroke Rehabilitation Exercises}, booktitle= {Proceedings of the 26th Portuguese Conference on Pattern Recognition}, year= {2020}, pages= {61-62}, month= {October}, address= {\\'{E}vora, Portugal}, organization= {University of \\'{E}vora}}\n\n";
//bibteste2 = "@article{Bernardino2021,title = {Break the Ice: a Survey on Socially Aware Engagement for Human?Robot First Encounters},journal = {International Journal of Social Robotics},year = {2021},author = {Avelino, J. and Garcia-Marques, L. and Ventura, R. and Bernardino, A.}}";
//
//json_bib = bibtexParse.toJSON(bibteste2)
