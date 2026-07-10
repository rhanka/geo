if (uts == undefined)
    var uts = {};
if (uts.apps == undefined)
    uts.apps = {};
if (uts.apps.docList == undefined)
    uts.apps.docList = {};
if (uts.apps.docList.labels == undefined)
    uts.apps.docList.labels = {};

uts.apps.docList.description = "";
uts.apps.docList.name = "";
uts.apps.docList.expand = "ALL";
uts.apps.docList.sortBy = "NAME-ASC";
uts.apps.docList.showPublishedOn = true;
uts.apps.docList.showCreatedOn = true;
uts.apps.docList.showSize = true;
uts.apps.docList.documents = [];
uts.apps.docList.groups = [];

uts.apps.docList.render = function()
{
    /* Write the containing DIV */
    document.write("<div id='list-" + uts.apps.docList.id + "'></div>");
    
    /* Write the NAME and DESCRIPTION */
    /*$("#list-" + uts.apps.docList.id).append($('<label>')
        .text(uts.apps.docList.name)
        .addClass("uts-doclist-name")
    );
    $("#list-" + uts.apps.docList.id).append($('<label>')
        .text(uts.apps.docList.description)
        .addClass("uts-doclist-description")
    );*/
    
    uts.apps.docList.renderGroups();
    uts.apps.docList.renderDocuments();
    uts.apps.docList.adjustLists();
};

uts.apps.docList.renderGroups = function(){
    $(uts.apps.docList.groups).each(function(){
        $("#list-" + uts.apps.docList.id).append($('<div>')
            .addClass("uts-doclist-group")
            .addClass("collapsed")
            .attr('group', $(this)[0].name)
            .text($(this)[0].name == "" ? uts.apps.docList.labels.groupGeneral : $(this)[0].name)
            .on('click', function(){
                if ($(this).hasClass('collapsed')){
                    $(this).next('table').show();
                    $(this).removeClass('collapsed');
                    $(this).find('.uts-doclist-icon-collapse').hide();
                    $(this).find('.uts-doclist-icon-expand').show();
                } else {
                    $(this).next('table').hide();
                    $(this).addClass('collapsed');
                    $(this).find('.uts-doclist-icon-collapse').show();
                    $(this).find('.uts-doclist-icon-expand').hide();
                }
            }).append($('<div>')
                .addClass('uts-doclist-icon-expand')
                .append($('<img>')
                    .attr('src', uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-expand.png')
                ).hide()
            ).append($('<div>')
                .addClass('uts-doclist-icon-collapse')
                .append($('<img>')
                    .attr('src', uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-collapse.png')
                )
            )
        );

        if (uts.apps.docList.type == "REG") {
            $("#list-" + uts.apps.docList.id).append($('<table>')
                .append($('<thead>')
                    .append($('<tr>')
                        .append($('<th>')
                            .addClass('uts-doclist-document-type')
                        ).append($('<th>')
                            .text(uts.apps.docList.labels.regYear)
                            .addClass('uts-doclist-document-reg-year')
                        ).append($('<th>')
                            .text(uts.apps.docList.labels.regNum)
                            .addClass('uts-doclist-document-reg-num')
                        ).append($('<th>')
                            .text(uts.apps.docList.labels.name)
                            .addClass('uts-doclist-document-name')
                        ).append($('<th>')
                            .text(uts.apps.docList.labels.size)
                            .addClass('uts-doclist-document-size')
                        ).append($('<th>')
                            .text(uts.apps.docList.labels.publishedOn)
                            .addClass('uts-doclist-document-publishedon')
                        ).append($('<th>')
                            .text(uts.apps.docList.labels.createdOn)
                            .addClass('uts-doclist-document-createdon')
                        )
                    )
                ).addClass('uts-doclist-documents')
                .hide()
            );
        } else {
            $("#list-" + uts.apps.docList.id).append($('<table>')
                .append($('<thead>')
                    .append($('<tr>')
                        .append($('<th>')
                            .addClass('uts-doclist-document-type')
                        ).append($('<th>')
                            .text(uts.apps.docList.labels.name)
                            .addClass('uts-doclist-document-name')
                        ).append($('<th>')
                            .text(uts.apps.docList.labels.size)
                            .addClass('uts-doclist-document-size')
                        ).append($('<th>')
                            .text(uts.apps.docList.labels.publishedOn)
                            .addClass('uts-doclist-document-publishedon')
                        ).append($('<th>')
                            .text(uts.apps.docList.labels.createdOn)
                            .addClass('uts-doclist-document-createdon')
                        )
                    )
                ).addClass('uts-doclist-documents')
                .hide()
            );
        }
    });
};

uts.apps.docList.renderDocuments = function ()
{
    $("#list-" + uts.apps.docList.id + ' table').each(function(){
        $(this).append($('<tbody>'));
    });

    if (uts.apps.docList.type == "REG") {
        $(uts.apps.docList.documents).each(function () {
            var group = $(this)[0].group;
            var groupRef = null;

            $($("#list-" + uts.apps.docList.id + ' .uts-doclist-group')).each(function () {
                if ($(this).attr('group') == group)
                    groupRef = this;
            });

            $(groupRef).next('table').append($('<tr>')
                .append($('<td>')
                    .append($('<img>')
                        .attr('src', uts.apps.docList.getFileType($(this)[0].type))
                    ).addClass('uts-doclist-document-type')
                ).append($('<td>')
                    .text($(this)[0].regYear)
                    .addClass('uts-doclist-document-reg-year')
                ).append($('<td>')
                    .text($(this)[0].regNum)
                    .addClass('uts-doclist-document-reg-num')
                ).append($('<td>')
                    .append($('<a>')
                        .text($(this)[0].name)
                        .attr('href', $(this)[0].type.toLowerCase() == "web" ? $(this)[0].url : uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/handlers/document.ashx?documentid=' + $(this)[0].id)
                        .attr('target', '_blank')
                    ).addClass('uts-doclist-document-name')
                ).append($('<td>')
                    .text($(this)[0].type.toLowerCase() == "web" ? "-" : uts.apps.docList.formatSize($(this)[0].size))
                    .addClass('uts-doclist-document-size')
                ).append($('<td>')
                    .text(uts.apps.docList.formatDate($(this)[0].publishedOn))
                    .addClass('uts-doclist-document-publishedon')
                ).append($('<td>')
                    .text(uts.apps.docList.formatDate($(this)[0].createdOn))
                    .addClass('uts-doclist-document-createdon')
                ).attr('type', $(this)[0].type)
                .attr('name', $(this)[0].name)
                .attr('size', $(this)[0].type.toLowerCase() == "web" ? "N/A" : $(this)[0].size)
                .attr('publishedOn', $(this)[0].publishedOn)
                .attr('createdOn', $(this)[0].createdOn)
                .attr('rank', $(this)[0].rank)
            );
        });
    } else {
        $(uts.apps.docList.documents).each(function () {
            var group = $(this)[0].group;
            var groupRef = null;

            $($("#list-" + uts.apps.docList.id + ' .uts-doclist-group')).each(function () {
                if ($(this).attr('group') == group)
                    groupRef = this;
            });

            $(groupRef).next('table').append($('<tr>')
                .append($('<td>')
                    .append($('<img>')
                        .attr('src', uts.apps.docList.getFileType($(this)[0].type))
                    ).addClass('uts-doclist-document-type')
                ).append($('<td>')
                    .append($('<a>')
                        .text($(this)[0].name)
                        .attr('href', $(this)[0].type.toLowerCase() == "web" ? $(this)[0].url : uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/handlers/document.ashx?documentid=' + $(this)[0].id)
                        .attr('target', '_blank')
                    ).addClass('uts-doclist-document-name')
                ).append($('<td>')
                    .text($(this)[0].type.toLowerCase() == "web" ? "-" : uts.apps.docList.formatSize($(this)[0].size))
                    .addClass('uts-doclist-document-size')
                ).append($('<td>')
                    .text(uts.apps.docList.formatDate($(this)[0].publishedOn))
                    .addClass('uts-doclist-document-publishedon')
                ).append($('<td>')
                    .text(uts.apps.docList.formatDate($(this)[0].createdOn))
                    .addClass('uts-doclist-document-createdon')
                ).attr('type', $(this)[0].type)
                .attr('name', $(this)[0].name)
                .attr('size', $(this)[0].type.toLowerCase() == "web" ? "N/A" : $(this)[0].size)
                .attr('publishedOn', $(this)[0].publishedOn)
                .attr('createdOn', $(this)[0].createdOn)
                .attr('rank', $(this)[0].rank)
            );
        });
    }
};

uts.apps.docList.adjustLists = function(id){
    if (!uts.apps.docList.showSize)
        $('.uts-doclist-document-size').hide();
    if (!uts.apps.docList.showPublishedOn)
        $('.uts-doclist-document-publishedon').hide();
    if (!uts.apps.docList.showCreatedOn)
        $('.uts-doclist-document-createdon').hide();
    
    if (uts.apps.docList.expand == "ALL"){
        $("#list-" + uts.apps.docList.id + ' .uts-doclist-group').each(function(){
            $(this).click()
        });
    } else if (uts.apps.docList.expand == "FIRST"){
        $("#list-" + uts.apps.docList.id + ' .uts-doclist-group').first().click();
    }

    if (!uts.apps.docList.showRegYear) {
        $('.uts-doclist-document-reg-year').remove();
    }

    if (!uts.apps.docList.showRegNum) {
        $('.uts-doclist-document-reg-num').remove();
    }
};

uts.apps.docList.sort = function(id){
    // find the group and sort it...
};

uts.apps.docList.getFileType = function(type){
    type = type.toLowerCase();

    if (type == "zip") return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-zip.png';
    if (type == "cab") return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-zip.png';
    if (type == "rar") return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-zip.png';
    if (type == "png") return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-jpg.png';
    if (type == "jpg") return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-jpg.png';
    if (type == "jpeg") return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-jpg.png';
    if (type == "bmp") return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-jpg.png';
    if (type == "tiff") return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-jpg.png';
    if (type == "tif") return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-pdf.png';
    if (type == "gif") return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-jpg.png';
    if (type == "xls") return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-xls.png';
    if (type == "xlsx") return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-xls.png';
    if (type == "xlsm") return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-xls.png';
    if (type == "doc") return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-doc.png';
    if (type == "docx") return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-doc.png';
    if (type == "docm") return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-doc.png';
    if (type == "pdf") return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-pdf.png';
    if (type == "mp3") return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-mp3.png';
    if (type == "wav") return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-mp3.png';
    if (type == "web") return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-web.png';

    return uts.apps.scheme + '://' + uts.apps.domain + '/doc-list/assets/icon-document.png';
}

uts.apps.docList.formatDate = function(date){
    var yyyy = date.getFullYear().toString();
    var MM = (date.getMonth() + 1).toString();
    var dd = date.getDate().toString();
    if (yyyy > 1902)
        return yyyy + "-" + uts.apps.docList.padLeft(MM) + "-" + uts.apps.docList.padLeft(dd);
    return "-";
};

uts.apps.docList.padLeft = function(number){
    if (number.length == 1)
        return "0" + number;
    return number;
};

uts.apps.docList.formatSize = function(bytes){
    var i = -1;
    var byteUnits = [' kB', ' MB', ' GB', ' TB', 'PB', 'EB', 'ZB', 'YB'];
    do {
        bytes = bytes / 1024;
        i++;
    } while (bytes > 1024);
    return Math.max(bytes, 0.1).toFixed(1) + byteUnits[i];
};

uts.apps.docList.truncate = function(text, maxLength){
    if (text.length > maxLength)
        return text.substr(0, maxLength) + "...";
    return text;
};