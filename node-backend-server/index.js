import express from 'express';
import cors from 'cors';

// Importing AWS DynamoDB SDK files for JavaScript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, ScanCommand, UpdateCommand, DeleteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// Importing AWS Cloud Map SDK files for JavaScript
import { ServiceDiscoveryClient, DiscoverInstancesCommand } from '@aws-sdk/client-servicediscovery';

// Client configurations
const config = {
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.access_key_id,
    secretAccessKey: process.env.secret_access_key
  },
};

// Configuring AWS Cloud Map client
const cloudMapClient = new ServiceDiscoveryClient(config);

// Configuring AWS DynamoDB client
const dynamoDbClient = new DynamoDBClient(config);
const documentClient = DynamoDBDocumentClient.from(dynamoDbClient);

const app = express();
app.use(cors({
  origin: "*",
  methods: "*",
  headers: "*",
}));

const port = 8000;

// Fetching table name from the AWS Cloud Map service
async function getTableName() {
    // Command to to get service discovery instance with attribute "name" as
    // dynamodb-table
    const findDbNameCommand = new DiscoverInstancesCommand({
        NamespaceName: 'backend-services-namespace',
        ServiceName: 'dynamodb-data-service',
        QueryParameters: {
            'name': 'dynamodb-table',
        }
    });

    // Sending command to the AWS Cloud Map service
    const response = await cloudMapClient.send(findDbNameCommand);

    // Extracting and returning the table name stored in the
    // "tablename" attribute
    const tableName = (response.Instances && response.Instances.length >= 1) ? response.Instances[0].Attributes.tablename : null;
    return tableName;
}

// The following custom function adds a new course in the
// DynamoDB database
async function putItemDB(courseObject, tableName) {
    try {
        const command = new PutCommand({
            TableName: tableName,
            Item: {
                "ID": Number(courseObject.id),
                "CourseName": courseObject.courseName,
                "CoverArt": decodeURIComponent(courseObject.courseCoverArt),
                "CourseUrl": decodeURIComponent(courseObject.courseUrl),
                "Author": courseObject.courseAuthor
            },
        });
        const response = await documentClient.send(command);
        return response;
    } catch (err) {
        return {error: err.message};
    }
};

// The following custom function updates an existing course in the
// DynamoDB database
async function updateItemDB(courseObject, tableName) {
    try {
        const command = new UpdateCommand({
            TableName: tableName,
            Key: {
                ID: Number(courseObject.id),
            },
            UpdateExpression: "SET CourseName = :name, CourseUrl = :url, CoverArt = :coverart, Author = :author",
            ExpressionAttributeValues: {
                ":name": courseObject.courseName,
                ":coverart": decodeURIComponent(courseObject.courseCoverArt),
                ":url": decodeURIComponent(courseObject.courseUrl),
                ":author": courseObject.courseAuthor
            },
            ReturnValues: 'ALL_NEW',
        });

        const response = await documentClient.send(command);
        return response;
    } catch (err) {
        return {error: err.message};
    }
};


// The following custom function fetches a specific course in the
// DynamoDB database
async function getItemDB(id, tableName) {
    if(!id && id !== 0)
        return null
    try {
        const command = new GetCommand({
            TableName: tableName,
            Key: {
                ID: Number(id)
            }
        });

        const response = await documentClient.send(command);
        return response;
    } catch (err) {
        return null;
    }
};

// The following custom function fetches all course IDs in the
// DynamoDB database
async function getAllItemsDB(tableName) {
    try {
        const command = new ScanCommand({
            TableName: tableName,
            ProjectionExpression: "ID",
        });

        const response = await documentClient.send(command);
        const coursesList = [];
        await Promise.all(response.Items.map(async (item) => {
            const course = await getItemDB(item.ID, tableName);
            if (course)
                coursesList.push(course.Item);
        }));
        return coursesList;
    } catch (err) {
        return {error: err.message};
    }
};

// The following custom function fetches all course IDs in the
// DynamoDB database
async function deleteItemDB(id, tableName) {
    try {
        const command = new DeleteCommand({
            TableName: tableName,
            Key: {
                ID: Number(id)
            },
        });

        const response = await documentClient.send(command);
        return response;
    } catch (err) {
        return {error: err.message};
    }
};

// Helper function to handle request, it's the same as the handle
// function of our Lambda function
async function requestHandler(query) {
    // Sending an Error if to query parameters are provided
    if (!query) {
        return {
            'statusCode': 400,
            'body': JSON.stringify({
                'success': false,
                'error': 'Invalid Request: Action not provided'
            })
        }
    }
    
    // Fetching table name from service discovery
    const tableName =  await getTableName();

    // Checking if table name is not found
    if (!tableName) {
        return {
            'statusCode': 500,
            'body': JSON.stringify({
                'success': false,
                'error': 'Internal Server Error: Could not find the Database'
            })
        }
    }

    // The following variable stores the value of the query parameters in the request
    const requestData = query;
    
    // The following variable stores the action to be performed
    const requestAction = requestData.action;

    // The following variable stores the course ID if it exists
    // in the query arguments
    const courseId = Number(requestData.id);

    // The following conditions get executed when the lambda function
    // is invoked
    switch(requestAction) {
        // The case when the request query is to get all courses
        case 'allCourses':
            const allCourses = await getAllItemsDB(tableName);

            if (allCourses.error) {
                return {
                    'statusCode': 500,
    
                    'body': JSON.stringify({
                        'success': false,
                        'error': `Unable to process request for ${requestAction}: ${allCourses.error}`
                    })
                };
            }

            // Returning response
            return {
                'statusCode': 200,

                'body': JSON.stringify({
                    'success': true,
                    'action': requestAction,
                    'allCourses': allCourses
                })
            };

        // The case when the request query is to add a new course
        case 'addCourse':
            const addCourse = await putItemDB(requestData, tableName);

            if (addCourse.error) {
                return {
                    'statusCode': 500,
    
                    'body': JSON.stringify({
                        'success': false,
                        'error': `Unable to process request for ${requestAction}: ${addCourse.error}`
                    })
                };
            }

            // Returning response
            return {
                'statusCode': 200,

                'body': JSON.stringify({
                    'success': true,
                    'action': requestAction,
                })
            };

        // The case when the request query is to edit an existing course
        case 'editCourse':
            const editCourse = await updateItemDB(requestData, tableName);

            if (editCourse.error) {
                return {
                    'statusCode': 500,
    
                    'body': JSON.stringify({
                        'success': false,
                        'error': `Unable to process request for ${requestAction}: ${editCourse.error}`
                    })
                };
            }

            // Returning response
            return {
                'statusCode': 200,

                'body': JSON.stringify({
                    'success': true,
                    'action': requestAction,
                })
            };
                
        // The case when the request query is to edit an existing course
        case 'removeCourse':
            const removeCourse = await deleteItemDB(courseId, tableName);

            if (removeCourse.error) {
                return {
                    'statusCode': 500,
    
                    'body': JSON.stringify({
                        'success': false,
                        'error': `Unable to process request for ${requestAction}: ${removeCourse.error}`
                    })
                };
            }

            // Returning response
            return {
                'statusCode': 200,

                'body': JSON.stringify({
                    'success': true,
                    'action': requestAction,
                })
            };

        // The default case when the field itself is unidentified
        default:
            return {
                'statusCode': 400,

                'body': JSON.stringify({
                    'success': false,
                    'error': `Invalid Request: Action ${requestAction} ${typeof requestAction} not found`,
                })
            };
    } 
};

// Handling all client requests through one endpoint
app.all('/', async function(req, res, next) {
    try {
      const resObj = await requestHandler(req.query);
      if (!resObj) {
        res.status(404).send({'message': 'Failed API server not reachable'});
      } else {
        res.status(resObj.statusCode).send(resObj.body);
      }
    } catch (err) {
      res.status(404).send({'message': `API server not reachable ${err}`});
    }
    next();
  });
  
// Starting Express server
app.listen(port);
console.log(`Server started at http://localhost:${port}`);
